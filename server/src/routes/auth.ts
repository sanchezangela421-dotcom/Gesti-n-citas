import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email';
import { upload } from '../middleware/upload';
import { metadataValue, type LegacyField } from '../lib/registrationFields';
import { mayRegisterInOrganization } from '../lib/registration';
import {
  writeAuditNow, requestContext, auditText,
  AUTH_ACTION, LOGIN_FAILURE, UNKNOWN_ACTOR,
} from '../services/auditLogger';

const router = Router();

/**
 * Lo que necesita el cliente para pintar la sesión: el perfil de especialista y
 * la organización CON su catálogo de departamentos (color, icono y si exige
 * nota). Se comparte entre el login y /me para que ambos devuelvan lo mismo.
 */
const SESSION_INCLUDE = {
  specialist: true,
  organization: {
    include: {
      orgDepartments: {
        where: { active: true },
        orderBy: [{ order: 'asc' as const }, { name: 'asc' as const }],
        select: { id: true, name: true, color: true, icon: true, requiresNote: true, order: true },
      },
    },
  },
};
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET no está configurado en las variables de entorno');

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const ctx = requestContext(req);

    /**
     * Registra un acceso rechazado con su motivo REAL.
     *
     * La respuesta al cliente es deliberadamente vaga para no revelar si un
     * correo existe; la bitácora sí guarda el motivo, que es lo que distingue
     * un tanteo masivo de la insistencia sobre una cuenta concreta.
     */
    const auditFailure = (
      reason: string,
      u?: { id: string; role: string; organizationId: string | null },
    ) => writeAuditNow({
      actorId:      u?.id ?? UNKNOWN_ACTOR,
      actorRole:    u?.role ?? UNKNOWN_ACTOR,
      action:       AUTH_ACTION.LOGIN_FAILED,
      targetEntity: 'Auth',
      targetId:     u?.id ?? 'login',
      organizationId: u?.organizationId ?? null,
      metadata:     { reason, email: auditText(email) },
      ...ctx,
    });

    // El TIPO se valida antes de tocar la base y antes de bcrypt.
    //
    // Con una contraseña que no es cadena, `bcrypt.compare` lanza y el catch de
    // abajo responde 500, mientras que un correo inexistente responde 401. Esa
    // diferencia delata que la cuenta existe, que es justo lo que el mensaje
    // genérico trata de ocultar. Un correo que no es cadena rompe igual dentro
    // de Prisma.
    if (typeof email !== 'string' || typeof password !== 'string') {
      await auditFailure(LOGIN_FAILURE.MALFORMED_CREDENTIALS);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: SESSION_INCLUDE,
    });
    
    if (!user) {
      await auditFailure(LOGIN_FAILURE.USER_NOT_FOUND);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      await auditFailure(LOGIN_FAILURE.WRONG_PASSWORD, user);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Superadmin must use the dedicated /api/superadmin/login endpoint
    if (user.role === 'superadmin') {
      // Con la contraseña correcta: o el superadmin se equivocó de puerta, o
      // alguien con sus credenciales está tanteando por dónde entrar.
      await auditFailure(LOGIN_FAILURE.SUPERADMIN_VIA_USER_LOGIN, user);
      return res.status(403).json({ error: 'Credenciales inválidas' });
    }

    // Cuenta dada de baja: la fila se conserva por retención del expediente, pero
    // no puede volver a operar hasta que un administrador la reactive.
    if (user.deletedAt) {
      await auditFailure(LOGIN_FAILURE.ACCOUNT_DEACTIVATED, user);
      return res.status(403).json({ code: 'ACCOUNT_DEACTIVATED', error: 'Esta cuenta fue dada de baja. Contacta al administrador de tu organización.' });
    }

    // Organización suspendida: suspender un tenant debe dejar fuera también a los
    // usuarios que ya existían, no solo impedir registros nuevos.
    if (user.organization && !user.organization.active) {
      await auditFailure(LOGIN_FAILURE.ORG_SUSPENDED, user);
      return res.status(403).json({ code: 'ORGANIZATION_SUSPENDED', error: 'El acceso de tu organización está suspendido. Contacta a soporte.' });
    }

    // Block unverified end-users (alumno y usuario)
    if ((user.role === 'alumno' || user.role === 'usuario') && !user.emailVerified) {
      await auditFailure(LOGIN_FAILURE.EMAIL_NOT_VERIFIED, user);
      return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Debes verificar tu correo antes de iniciar sesión.' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId ?? null, tokenVersion: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256' }
    );

    await writeAuditNow({
      actorId:      user.id,
      actorRole:    user.role,
      action:       AUTH_ACTION.LOGIN_SUCCESS,
      targetEntity: 'Auth',
      targetId:     user.id,
      organizationId: user.organizationId ?? null,
      metadata:     { email: user.email },
      ...ctx,
    });

    // Remove password from object before sending
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      token,
      user: userWithoutPassword
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const data = req.body;

    // Validate email format
    if (!data.email || !EMAIL_REGEX.test(data.email)) {
      return res.status(400).json({ error: 'El formato del correo no es válido' });
    }

    // Mismo mínimo que reset-password y change-password
    if (typeof data.password !== 'string' || data.password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    // A qué organización entra, y si puede.
    //
    // La organización es OBLIGATORIA. Antes era opcional y omitirla dejaba la
    // cuenta en el grupo sin inquilino, que no es un limbo: `orgScope` lo trata
    // como un filtro concreto, así que esa cuenta veía las filas heredadas sin
    // organización. Y mientras se pudiera omitir, cualquier regla de pertenencia
    // se saltaba con no mandar el campo.
    if (!data.organizationId || typeof data.organizationId !== 'string') {
      return res.status(400).json({
        code: 'ORGANIZATION_REQUIRED',
        error: 'Elige tu organización para continuar.',
      });
    }

    const org = await prisma.organization.findUnique({ where: { id: data.organizationId } });
    if (!org || !org.active) {
      return res.status(400).json({ error: 'Organización no válida o inactiva' });
    }

    // Quién pertenece lo decide la ORGANIZACIÓN, no una variable del proceso.
    // Ver lib/registration.ts: con varias organizaciones en la misma instalación,
    // un único ALLOWED_EMAIL_DOMAIN no podía expresar a la vez el dominio de la
    // escuela y que el paciente de un hospital llega con el correo que tenga.
    const permitido = mayRegisterInOrganization(org, data.email);
    if (!permitido.ok) {
      return res.status(permitido.status).json({ code: permitido.code, error: permitido.error });
    }

    // Check if user exists
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      return res.status(400).json({ error: 'El correo ya está registrado' });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(data.password, salt);
    
    // Create user with verification token (expires in 24h)
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Escuelas → alumno  |  empresas y hospitales → usuario
    // (la organización ya se resolvió y validó arriba)
    const userRole: UserRole = org.type === 'school' ? UserRole.alumno : UserRole.usuario;

    // Volcado a las columnas legacy.
    //
    // El panel normaliza la clave del campo al guardarla (`fechaNacimiento` se
    // almacena como `fechanacimiento`), pero aquí se buscaba en camelCase: por eso
    // ninguna organización creada desde el panel llenaba estas columnas y sus
    // gráficas demográficas salían vacías. `metadataValue` compara las claves sin
    // mayúsculas, acentos ni separadores, así que da igual cómo se haya nombrado.
    const legacyField = (field: LegacyField, direct: unknown): string | null => {
      const fromMetadata = metadataValue(data.metadata, field);
      if (fromMetadata) return fromMetadata;
      if (typeof direct === "string" && direct.trim()) return direct.trim();
      if (typeof direct === "number") return String(direct);
      return null;
    };

    const semestreRaw = legacyField("semestre", data.semestre);
    const semestre = semestreRaw !== null && Number.isFinite(Number(semestreRaw))
      ? Number(semestreRaw)
      : null;

    const user = await prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
        role: userRole,
        organizationId: org.id,
        metadata: data.metadata || null,
        // Campos legacy para compatibilidad con TECNL — se pueblan desde metadata
        matricula: legacyField("matricula", data.matricula),
        carrera: legacyField("carrera", data.carrera),
        semestre,
        fechaNacimiento: legacyField("fechaNacimiento", data.fechaNacimiento),
        genero: legacyField("genero", data.genero),
        emailVerified: false,
        verificationToken,
        verificationTokenExpiresAt,
      }
    });

    // Send verification email (non-blocking)
    sendVerificationEmail(user.name, user.email, verificationToken).catch(err => {
      console.error('Error sending verification email:', err);
    });

    // El alta es el momento en que una cuenta entra a existir: sin registrarla,
    // una creación masiva de cuentas no dejaría rastro en ninguna parte.
    await writeAuditNow({
      actorId:      user.id,
      actorRole:    user.role,
      action:       AUTH_ACTION.REGISTER_SUCCESS,
      targetEntity: 'User',
      targetId:     user.id,
      organizationId: user.organizationId ?? null,
      metadata:     { email: user.email, role: user.role },
      ...requestContext(req),
    });

    res.status(201).json({ message: 'Registro exitoso. Revisa tu correo para verificar tu cuenta.' });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Error registrando usuario' });
  }
});

// GET /api/auth/verify/:token
router.get('/verify/:token', async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  try {
    const user = await prisma.user.findFirst({
      where: { verificationToken: req.params.token }
    });

    if (!user) {
      return res.redirect(`${frontendUrl}?verified=false`);
    }

    if (user.verificationTokenExpiresAt && user.verificationTokenExpiresAt < new Date()) {
      return res.redirect(`${frontendUrl}?verified=expired`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verificationToken: null, verificationTokenExpiresAt: null }
    });

    await writeAuditNow({
      actorId:      user.id,
      actorRole:    user.role,
      action:       AUTH_ACTION.EMAIL_VERIFIED,
      targetEntity: 'User',
      targetId:     user.id,
      organizationId: user.organizationId ?? null,
      metadata:     { email: user.email },
      ...requestContext(req),
    });

    res.redirect(`${frontendUrl}?verified=true`);
  } catch (error) {
    console.error('Verification error:', error);
    res.redirect(`${frontendUrl}?verified=false`);
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    // `req.body` es `any`: un valor que no es cadena llega hasta el `where` de
    // Prisma. Se responde lo mismo que en el caso bueno para no distinguirlo.
    if (typeof email !== 'string') {
      return res.json({ message: 'Si el correo existe y no está verificado, recibirás un nuevo enlace.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond OK to avoid leaking which emails exist
    // (las cuentas dadas de baja tampoco reciben correo, pero la respuesta no lo revela)
    if (!user || user.emailVerified || user.deletedAt) {
      return res.json({ message: 'Si el correo existe y no está verificado, recibirás un nuevo enlace.' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationToken, verificationTokenExpiresAt }
    });

    sendVerificationEmail(user.name, user.email, verificationToken).catch(err => {
      console.error('Error resending verification email:', err);
    });

    res.json({ message: 'Si el correo existe y no está verificado, recibirás un nuevo enlace.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Mismo criterio que el resto del archivo: el tipo se valida antes de que el
    // valor llegue al `where`, y la respuesta no distingue este caso.
    if (typeof email !== 'string') {
      return res.json({ message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond OK to avoid leaking which emails exist
    // (las cuentas dadas de baja tampoco reciben correo, pero la respuesta no lo revela)
    if (!user || user.deletedAt) {
      // Se audita IGUAL que el caso bueno: la respuesta al cliente no distingue,
      // pero recorrer este endpoint con una lista de correos es una forma de
      // enumerar cuentas, y sin registrar los fallidos no habría cómo verlo.
      await writeAuditNow({
        actorId:      user?.id ?? UNKNOWN_ACTOR,
        actorRole:    user?.role ?? UNKNOWN_ACTOR,
        action:       AUTH_ACTION.PASSWORD_RESET_REQUESTED,
        targetEntity: 'Auth',
        targetId:     user?.id ?? 'forgot-password',
        organizationId: user?.organizationId ?? null,
        metadata:     { email: auditText(email), delivered: false, reason: user ? 'account_deactivated' : 'user_not_found' },
        ...requestContext(req),
      });
      return res.json({ message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
    }

    const resetPasswordToken = crypto.randomBytes(32).toString('hex');
    const resetPasswordTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken, resetPasswordTokenExpiresAt }
    });

    sendPasswordResetEmail(user.name, user.email, resetPasswordToken).catch(err => {
      console.error('Error sending reset email:', err);
    });

    await writeAuditNow({
      actorId:      user.id,
      actorRole:    user.role,
      action:       AUTH_ACTION.PASSWORD_RESET_REQUESTED,
      targetEntity: 'Auth',
      targetId:     user.id,
      organizationId: user.organizationId ?? null,
      metadata:     { email: user.email, delivered: true },
      ...requestContext(req),
    });

    res.json({ message: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    // `typeof`, no solo truthiness.
    //
    // `req.body` es `any`, así que un objeto JSON llegaba intacto hasta el
    // `where` y Prisma lo interpretaba como FILTRO sobre la columna
    // (`{ not: null }`, `{ startsWith: … }`) en vez de como el token. Con eso,
    // una petición sin autenticar podía seleccionar la cuenta de otra persona
    // sin haber recibido nunca su enlace, y el handler le escribía la contraseña.
    // Que un objeto en esa posición es un filtro se ve en el propio proyecto:
    // stats.ts filtra `User.id` (String) con `{ in: … }`.
    if (typeof token !== 'string' || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Token y contraseña (mínimo 6 caracteres) son requeridos' });
    }

    const user = await prisma.user.findFirst({
      // `equals` explícito: la forma del operando la fija el servidor, no quien
      // llama. Aunque mañana alguien quite el `typeof` de arriba, un objeto ya
      // no puede redefinir la comparación.
      where: { resetPasswordToken: { equals: token } }
    });

    // Una cuenta dada de baja no puede reactivarse a sí misma por el enlace de
    // recuperación: la reactivación es una decisión del administrador.
    if (!user || user.deletedAt) {
      // Un enlace que no corresponde a nadie es, o un enlace ya usado, o alguien
      // probando tokens. En ningún caso debe pasar en silencio.
      await writeAuditNow({
        actorId:      user?.id ?? UNKNOWN_ACTOR,
        actorRole:    user?.role ?? UNKNOWN_ACTOR,
        action:       AUTH_ACTION.PASSWORD_RESET_FAILED,
        targetEntity: 'Auth',
        targetId:     user?.id ?? 'reset-password',
        organizationId: user?.organizationId ?? null,
        metadata:     { reason: user ? 'account_deactivated' : 'invalid_token' },
        ...requestContext(req),
      });
      return res.status(400).json({ code: 'INVALID_TOKEN', error: 'El enlace no es válido.' });
    }

    if (user.resetPasswordTokenExpiresAt && user.resetPasswordTokenExpiresAt < new Date()) {
      await writeAuditNow({
        actorId:      user.id,
        actorRole:    user.role,
        action:       AUTH_ACTION.PASSWORD_RESET_FAILED,
        targetEntity: 'Auth',
        targetId:     user.id,
        organizationId: user.organizationId ?? null,
        metadata:     { email: user.email, reason: 'expired_token' },
        ...requestContext(req),
      });
      // Se limpia el token vencido. Antes se devolvía sin borrarlo, así que los
      // tokens viejos se quedaban en la columna indefinidamente: cada uno es una
      // fila más que cualquier consulta futura sobre esa columna puede emparejar.
      await prisma.user.update({
        where: { id: user.id },
        data: { resetPasswordToken: null, resetPasswordTokenExpiresAt: null },
      });

      return res.status(400).json({ code: 'EXPIRED_TOKEN', error: 'El enlace ha expirado. Solicita uno nuevo.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordTokenExpiresAt: null,
        // Invalida cualquier sesión previa (clave para recuperar una cuenta comprometida)
        tokenVersion: { increment: 1 },
        // Si el usuario nunca verificó su email (creado por SuperAdmin), lo marca al activar
        ...(user.emailVerified ? {} : { emailVerified: true }),
      }
    });

    // Cambiar la contraseña invalida las sesiones abiertas: es la acción con la
    // que se recupera una cuenta comprometida, y también con la que se secuestra.
    await writeAuditNow({
      actorId:      user.id,
      actorRole:    user.role,
      action:       AUTH_ACTION.PASSWORD_RESET_COMPLETED,
      targetEntity: 'User',
      targetId:     user.id,
      organizationId: user.organizationId ?? null,
      metadata:     { email: user.email },
      ...requestContext(req),
    });

    res.json({ message: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// PATCH /api/auth/avatar
router.patch('/avatar', verifyToken as any, upload.single('avatar'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se proporcionó imagen' });
    const avatarUrl = `/uploads/${req.file.filename}`;
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl } });
    res.json({ avatarUrl });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'Contraseña actual y nueva contraseña (mínimo 6 caracteres) son requeridas' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ code: 'WRONG_PASSWORD', error: 'La contraseña actual es incorrecta' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, tokenVersion: { increment: 1 } },
      select: { id: true, email: true, role: true, organizationId: true, tokenVersion: true },
    });

    // Reemite el token con el nuevo tokenVersion: conserva la sesión actual e
    // invalida cualquier otra sesión abierta con la contraseña anterior.
    const token = jwt.sign(
      { id: updated.id, email: updated.email, role: updated.role, organizationId: updated.organizationId ?? null, tokenVersion: updated.tokenVersion },
      JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256' }
    );

    res.json({ message: 'Contraseña actualizada correctamente.', token });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /api/auth/me
router.get('/me', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: SESSION_INCLUDE,
    });

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

export default router;
