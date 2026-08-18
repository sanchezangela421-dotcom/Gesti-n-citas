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
    
    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: SESSION_INCLUDE,
    });
    
    if (!user) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Superadmin must use the dedicated /api/superadmin/login endpoint
    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'Credenciales inválidas' });
    }

    // Cuenta dada de baja: la fila se conserva por retención del expediente, pero
    // no puede volver a operar hasta que un administrador la reactive.
    if (user.deletedAt) {
      return res.status(403).json({ code: 'ACCOUNT_DEACTIVATED', error: 'Esta cuenta fue dada de baja. Contacta al administrador de tu organización.' });
    }

    // Organización suspendida: suspender un tenant debe dejar fuera también a los
    // usuarios que ya existían, no solo impedir registros nuevos.
    if (user.organization && !user.organization.active) {
      return res.status(403).json({ code: 'ORGANIZATION_SUSPENDED', error: 'El acceso de tu organización está suspendido. Contacta a soporte.' });
    }

    // Block unverified end-users (alumno y usuario)
    if ((user.role === 'alumno' || user.role === 'usuario') && !user.emailVerified) {
      return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Debes verificar tu correo antes de iniciar sesión.' });
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, organizationId: user.organizationId ?? null, tokenVersion: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: '24h', algorithm: 'HS256' }
    );
    
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

    // Validate institutional email domain
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN;
    if (allowedDomain && data.email) {
      const emailDomain = data.email.split('@')[1];
      if (emailDomain !== allowedDomain) {
        return res.status(400).json({ error: `Solo se permiten correos institucionales (@${allowedDomain})` });
      }
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

    // Validar que la organización existe y determinar el rol según su tipo
    let userRole: UserRole = UserRole.alumno;
    if (data.organizationId) {
      const org = await prisma.organization.findUnique({ where: { id: data.organizationId } });
      if (!org || !org.active) {
        return res.status(400).json({ error: 'Organización no válida o inactiva' });
      }
      // Escuelas → alumno  |  empresas y hospitales → usuario
      userRole = org.type === 'school' ? UserRole.alumno : UserRole.usuario;
    }

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
        organizationId: data.organizationId || null,
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
    const user = await prisma.user.findUnique({ where: { email } });

    // Always respond OK to avoid leaking which emails exist
    // (las cuentas dadas de baja tampoco reciben correo, pero la respuesta no lo revela)
    if (!user || user.deletedAt) {
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

    if (!token || !password || password.length < 6) {
      return res.status(400).json({ error: 'Token y contraseña (mínimo 6 caracteres) son requeridos' });
    }

    const user = await prisma.user.findFirst({
      where: { resetPasswordToken: token }
    });

    // Una cuenta dada de baja no puede reactivarse a sí misma por el enlace de
    // recuperación: la reactivación es una decisión del administrador.
    if (!user || user.deletedAt) {
      return res.status(400).json({ code: 'INVALID_TOKEN', error: 'El enlace no es válido.' });
    }

    if (user.resetPasswordTokenExpiresAt && user.resetPasswordTokenExpiresAt < new Date()) {
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

    if (!currentPassword || !newPassword || newPassword.length < 6) {
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
