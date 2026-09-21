import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../db';
import { SuperAdminRequest } from '../../middleware/verifySuperAdmin';
import { writeAudit, requestContext, SUPERADMIN_ACTION } from '../../services/auditLogger';
import { tryAccountInvitation } from '../../services/email';
import { cancelOpenAppointments, notifyCancelledByDeactivation } from '../../services/deactivation';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';
const INVITATION_EXPIRY_MS = 72 * 60 * 60 * 1000; // 72 horas

const router = Router();

const EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/;
const PAGE_SIZE   = 50;
const VALID_ROLES = Object.values(UserRole) as string[];

// ── GET /api/superadmin/users?orgId=&role=&page= ──────────────────────────────

router.get('/', async (req: SuperAdminRequest, res) => {
  try {
    const orgId = req.query.orgId as string | undefined;
    const role  = req.query.role  as string | undefined;
    const page  = Math.max(1, parseInt((req.query.page as string) ?? '1'));

    const where: Prisma.UserWhereInput = {};
    if (orgId) where.organizationId = orgId;
    if (role)  where.role = role as Prisma.EnumUserRoleFilter;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, email: true, name: true, role: true,
          organizationId: true, emailVerified: true, createdAt: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.user.count({ where }),
    ]);

    // Consultar usuarios de cualquier organización es la capacidad más sensible
    // del superadmin y no dejaba ningún rastro. Se guarda el ALCANCE de lo que
    // vio —filtro y número de filas—, no las filas: copiarlas aquí duplicaría los
    // datos personales en otra tabla.
    //
    // Al vuelo (`writeAudit`) a propósito: es una consulta, no un evento de
    // seguridad irrepetible, y un listado no debe tardar más por la bitácora.
    writeAudit({
      actorId:      req.actor!.id,
      actorRole:    'superadmin',
      action:       SUPERADMIN_ACTION.USERS_VIEWED,
      targetEntity: 'UserList',
      targetId:     orgId ?? 'todas',
      organizationId: orgId ?? null,
      metadata: { filtro: { orgId: orgId ?? null, role: role ?? null, page }, filas: users.length, total },
      ...requestContext(req),
    });

    res.json({ users, total, page, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error('[superadmin] Error fetching users:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/superadmin/users — crear usuario con flujo de invitación ────────
// No recibe contraseña — el usuario la define al activar su cuenta por correo

router.post('/', async (req: SuperAdminRequest, res) => {
  try {
    const { name, email, role, organizationId } =
      req.body as { name?: string; email?: string; role?: string; organizationId?: string };

    if (!name?.trim() || !email || !role) {
      return res.status(400).json({ error: 'name, email y role son requeridos' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Formato de correo inválido' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Rol inválido. Valores válidos: ${VALID_ROLES.join(', ')}` });
    }
    if (role !== 'superadmin' && !organizationId) {
      return res.status(400).json({ error: 'organizationId es requerido para este rol' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'El correo ya está registrado' });

    let orgName = 'la plataforma';
    if (organizationId) {
      const org = await prisma.organization.findUnique({ where: { id: organizationId } });
      if (!org)        return res.status(404).json({ error: 'Organización no encontrada' });
      if (!org.active) return res.status(409).json({ error: 'La organización está inactiva' });
      orgName = org.name;
    }

    // Contraseña inutilizable hasta que el usuario active su cuenta
    const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const activationToken  = crypto.randomBytes(32).toString('hex');
    const tokenExpiry      = new Date(Date.now() + INVITATION_EXPIRY_MS);

    const user = await prisma.user.create({
      data: {
        email,
        password:                   unusablePassword,
        name:                       name.trim(),
        role:                       role as UserRole,
        emailVerified:              false,
        organizationId:             organizationId ?? null,
        resetPasswordToken:         activationToken,
        resetPasswordTokenExpiresAt: tokenExpiry,
      },
      select: {
        id: true, email: true, name: true, role: true,
        organizationId: true, createdAt: true,
      },
    });

    const activationUrl = `${FRONTEND_URL}?reset_token=${activationToken}`;
    const invitationSent = await tryAccountInvitation(name.trim(), email, orgName, role, activationUrl);

    writeAudit({
      actorId:        req.actor!.id,
      actorRole:      'superadmin',
      action:         'CREATE_USER',
      targetEntity:   'User',
      targetId:       user.id,
      organizationId: organizationId ?? null,
      metadata:       { email, role, orgName, invitationSent },
      ...requestContext(req),
    });

    res.status(201).json({ ...user, invitationSent });
  } catch (error) {
    console.error('[superadmin] Error creating user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PATCH /api/superadmin/users/:id — editar usuario ─────────────────────────

router.patch('/:id', async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;
    const { name, email, role, organizationId, password } =
      req.body as { name?: string; email?: string; role?: string; organizationId?: string; password?: string };

    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    // No puede degradar su propia cuenta
    if (id === req.actor!.id && role && role !== 'superadmin') {
      return res.status(403).json({ error: 'No puedes cambiar el rol de tu propia cuenta' });
    }

    if (email && !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Formato de correo inválido' });
    }
    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `Rol inválido. Valores válidos: ${VALID_ROLES.join(', ')}` });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
    }

    if (email && email !== target.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email } });
      if (emailTaken) return res.status(409).json({ error: 'El correo ya está en uso' });
    }

    const data: Prisma.UserUpdateInput = {};
    if (name)                         data.name  = name.trim();
    if (email)                        data.email = email;
    if (role)                         data.role  = role as UserRole;
    if (organizationId !== undefined) data.organization = organizationId
      ? { connect: { id: organizationId } }
      : { disconnect: true };
    if (password) data.password = await bcrypt.hash(password, 10);

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, email: true, name: true, role: true,
        organizationId: true, createdAt: true,
      },
    });

    writeAudit({
      actorId:        req.actor!.id,
      actorRole:      'superadmin',
      action:         'UPDATE_USER',
      targetEntity:   'User',
      targetId:       id,
      organizationId: target.organizationId,
      metadata:       { changedFields: Object.keys(data).filter(k => k !== 'password') },
      ...requestContext(req),
    });

    res.json(updated);
  } catch (error) {
    console.error('[superadmin] Error updating user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── DELETE /api/superadmin/users/:id — dar de baja usuario ───────────────────
// BAJA LÓGICA, nunca borrado físico: ni siquiera el superadmin puede eliminar a
// una persona con expediente clínico (retención NOM-004). La cuenta se conserva
// y deja de operar; sus citas abiertas se cancelan avisando a la contraparte.

router.delete('/:id', async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;

    if (id === req.actor!.id) {
      return res.status(403).json({ error: 'No puedes dar de baja tu propia cuenta' });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      include: { specialist: { select: { id: true } } },
    });
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (target.role === 'superadmin') {
      return res.status(403).json({ error: 'No se puede dar de baja otra cuenta de SuperAdmin' });
    }
    if (target.deletedAt) {
      return res.status(409).json({ error: 'Esta cuenta ya está dada de baja' });
    }

    const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = rawReason || 'La cuenta fue dada de baja por la administración de la plataforma.';
    const now = new Date();

    const { cancelled, isSpecialist } = await prisma.$transaction(async (tx) => {
      // Un especialista se cancela por sus citas como prestador; cualquier otro
      // rol, por las citas que tiene como paciente.
      const affected = target.specialist
        ? await cancelOpenAppointments(tx, { specialistId: target.specialist.id }, reason)
        : await cancelOpenAppointments(tx, { studentId: id }, reason);

      if (target.specialist) {
        await tx.specialist.update({
          where: { id: target.specialist.id },
          data: { deletedAt: now, active: false },
        });
        await tx.scheduleSlot.deleteMany({ where: { specialistId: target.specialist.id } });
      }

      await tx.user.update({
        where: { id },
        data: { deletedAt: now, tokenVersion: { increment: 1 } },
      });

      return { cancelled: affected, isSpecialist: !!target.specialist };
    });

    notifyCancelledByDeactivation(
      cancelled,
      isSpecialist ? 'students' : 'specialists',
      reason,
      target.organizationId,
    );

    writeAudit({
      actorId:        req.actor!.id,
      actorRole:      'superadmin',
      action:         'USER_DEACTIVATED',
      targetEntity:   'User',
      targetId:       id,
      organizationId: target.organizationId,
      metadata:       { email: target.email, role: target.role, reason, cancelledAppointments: cancelled.length },
      ...requestContext(req),
    });

    res.json({ success: true, cancelledAppointments: cancelled.length });
  } catch (error) {
    console.error('[superadmin] Error deactivating user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/superadmin/users/:id/restore — reactivar usuario ───────────────

router.post('/:id/restore', async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;

    const target = await prisma.user.findUnique({
      where: { id },
      include: { specialist: { select: { id: true } } },
    });
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!target.deletedAt) return res.status(409).json({ error: 'Esta cuenta no está dada de baja' });

    await prisma.$transaction(async (tx) => {
      if (target.specialist) {
        await tx.specialist.update({
          where: { id: target.specialist.id },
          data: { deletedAt: null, active: true },
        });
      }
      await tx.user.update({ where: { id }, data: { deletedAt: null } });
    });

    writeAudit({
      actorId:        req.actor!.id,
      actorRole:      'superadmin',
      action:         'USER_REACTIVATED',
      targetEntity:   'User',
      targetId:       id,
      organizationId: target.organizationId,
      metadata:       { email: target.email, role: target.role },
      ...requestContext(req),
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[superadmin] Error restoring user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/superadmin/users/:id/resend-invitation ────────────────────────
//
// Sin esto, una invitación que no sale deja una cuenta que NADIE puede activar:
// el invitado no sabe que existe, así que tampoco va a pedir "olvidé mi
// contraseña". La única salida aparente es crear otra cuenta — y eso fue lo que
// pasó el 2026-09-20 al vencerse el plan de correo: cuatro administradores de
// más para la misma organización, uno por cada reintento a ciegas.

router.post('/:id/resend-invitation', async (req: SuperAdminRequest, res) => {
  try {
    const id = req.params.id as string;

    const user = await prisma.user.findUnique({
      where: { id },
      include: { organization: { select: { name: true, active: true } } },
    });
    if (!user || user.deletedAt) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    if (user.emailVerified) {
      return res.status(409).json({ error: 'La cuenta ya está activada; usa restablecer contraseña' });
    }
    if (user.organization && !user.organization.active) {
      return res.status(409).json({ error: 'La organización está inactiva' });
    }

    // El enlace se renueva en cada reenvío: si el correo que falló acabara
    // llegando, su enlace ya no sirve, y el plazo vuelve a contar desde ahora.
    const activationToken = crypto.randomBytes(32).toString('hex');
    await prisma.user.update({
      where: { id },
      data: {
        resetPasswordToken:          activationToken,
        resetPasswordTokenExpiresAt: new Date(Date.now() + INVITATION_EXPIRY_MS),
      },
    });

    const invitationSent = await tryAccountInvitation(
      user.name,
      user.email,
      user.organization?.name ?? 'la plataforma',
      user.role,
      `${FRONTEND_URL}?reset_token=${activationToken}`,
    );

    writeAudit({
      actorId:        req.actor!.id,
      actorRole:      'superadmin',
      action:         'RESEND_INVITATION',
      targetEntity:   'User',
      targetId:       user.id,
      organizationId: user.organizationId,
      metadata:       { email: user.email, invitationSent },
      ...requestContext(req),
    });

    res.json({ invitationSent });
  } catch (error) {
    console.error('[superadmin] Error resending invitation:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/superadmin/users/organizations/:orgId/admin ────────────────────

router.post('/organizations/:orgId/admin', async (req: SuperAdminRequest, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { name, email } = req.body as { name?: string; email?: string };

    if (!name?.trim() || !email) {
      return res.status(400).json({ error: 'name y email son requeridos' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Formato de correo inválido' });
    }

    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    if (!org)        return res.status(404).json({ error: 'Organización no encontrada' });
    if (!org.active) return res.status(409).json({ error: 'La organización está inactiva' });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'El correo ya está registrado' });

    const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
    const activationToken  = crypto.randomBytes(32).toString('hex');
    const tokenExpiry      = new Date(Date.now() + INVITATION_EXPIRY_MS);

    const admin = await prisma.user.create({
      data: {
        email,
        password:                   unusablePassword,
        name:                       name.trim(),
        role:                       'admin',
        emailVerified:              false,
        organizationId:             orgId,
        resetPasswordToken:         activationToken,
        resetPasswordTokenExpiresAt: tokenExpiry,
      },
      select: {
        id: true, email: true, name: true, role: true,
        organizationId: true, createdAt: true,
      },
    });

    const activationUrl = `${FRONTEND_URL}?reset_token=${activationToken}`;
    const invitationSent = await tryAccountInvitation(name.trim(), email, org.name, 'admin', activationUrl);

    writeAudit({
      actorId:        req.actor!.id,
      actorRole:      'superadmin',
      action:         'CREATE_ORG_ADMIN',
      targetEntity:   'User',
      targetId:       admin.id,
      organizationId: orgId,
      metadata:       { email, orgName: org.name, invitationSent },
      ...requestContext(req),
    });

    res.status(201).json({ ...admin, invitationSent });
  } catch (error) {
    console.error('[superadmin] Error creating org admin:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
