import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';
import { cancelOpenAppointments, notifyCancelledByDeactivation } from '../services/deactivation';
import { writeAudit, getClientIp } from '../services/auditLogger';

const router = Router();

// GET /api/users — role-based filtering
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const caller = req.user!;
    const where: any = { ...orgScope(req.user) };

    // Los dados de baja se ocultan por defecto. Solo el admin puede pedirlos
    // explícitamente (?includeDeleted=1) para poder reactivarlos desde su panel.
    const isManager = caller.role === 'admin' || caller.role === 'superadmin';
    if (!(isManager && req.query.includeDeleted === '1')) where.deletedAt = null;

    if (isManager) {
      // Admin/superadmin sees all within their scope; optional ?role= filter
      const role = req.query.role as string | undefined;
      if (role) where.role = role;
    } else if (caller.role === 'especialista') {
      // Specialists only need end-user data (alumno o usuario según el tipo de org)
      where.role = { in: ['alumno', 'usuario'] };
    } else {
      // Students only see themselves
      where.id = caller.id;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, role: true,
        matricula: true, carrera: true, semestre: true,
        fechaNacimiento: true, genero: true, department: true,
        metadata: true,
        createdAt: true,
        deletedAt: true,
        specialist: { select: { id: true, department: true, active: true } }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/users/:id
router.get('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;
    const caller = req.user!;

    // Non-admin can only fetch their own record
    if (caller.role !== 'admin' && caller.role !== 'superadmin' && caller.id !== id) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    // El scope evita que un admin consulte usuarios de otra organización
    const user = await prisma.user.findFirst({
      where: { id, ...orgScope(caller) },
      select: {
        id: true, email: true, name: true, role: true,
        matricula: true, carrera: true, semestre: true,
        fechaNacimiento: true, genero: true, department: true,
        deletedAt: true
      }
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/users/:id — admin only. BAJA LÓGICA, nunca borrado físico: el
// expediente clínico del paciente debe conservarse (NOM-004) y sus citas
// sostienen los reportes históricos.
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    // El scope evita que un admin dé de baja usuarios de otra organización
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null, ...orgScope(req.user) } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Guarda por ROL (la anterior comparaba contra un email que ya no existe en el
    // seed, dejando al admin real sin protección). La gestión de cuentas admin se
    // hace desde el panel de superadmin, que tiene sus propias validaciones.
    if (user.role === 'admin' || user.role === 'superadmin') {
      return res.status(403).json({ error: 'Las cuentas de administrador no se pueden dar de baja desde este panel' });
    }
    // Los especialistas se dan de baja por su propia ruta, que además retira
    // sus horarios publicados y marca el perfil Specialist.
    if (user.role === 'especialista') {
      return res.status(409).json({ error: 'Da de baja al especialista desde la pestaña de Especialistas.' });
    }

    const rawReason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    const reason = rawReason || 'La cuenta del paciente fue dada de baja.';

    const cancelled = await prisma.$transaction(async (tx) => {
      const affected = await cancelOpenAppointments(tx, { studentId: id }, reason);
      await tx.user.update({
        where: { id },
        // tokenVersion corta de inmediato cualquier sesión que siguiera abierta
        data: { deletedAt: new Date(), tokenVersion: { increment: 1 } },
      });
      return affected;
    });

    notifyCancelledByDeactivation(cancelled, 'specialists', reason, user.organizationId);

    writeAudit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'USER_DEACTIVATED',
      targetEntity: 'User',
      targetId: id,
      organizationId: user.organizationId,
      metadata: { name: user.name, email: user.email, role: user.role, reason, cancelledAppointments: cancelled.length },
      ipAddress: getClientIp(req),
    });

    res.json({ success: true, cancelledAppointments: cancelled.length });
  } catch (error) {
    console.error('Error deactivating user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/users/:id/restore — admin only. Revierte la baja lógica.
router.post('/:id/restore', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    const user = await prisma.user.findFirst({
      where: { id, NOT: { deletedAt: null }, ...orgScope(req.user) },
    });
    if (!user) return res.status(404).json({ error: 'Usuario dado de baja no encontrado' });
    if (user.role === 'especialista') {
      return res.status(409).json({ error: 'Reactiva al especialista desde la pestaña de Especialistas.' });
    }

    const restored = await prisma.user.update({
      where: { id },
      data: { deletedAt: null },
      select: { id: true, email: true, name: true, role: true, deletedAt: true },
    });

    writeAudit({
      actorId: req.user.id,
      actorRole: req.user.role,
      action: 'USER_REACTIVATED',
      targetEntity: 'User',
      targetId: id,
      organizationId: user.organizationId,
      metadata: { name: user.name, email: user.email, role: user.role },
      ipAddress: getClientIp(req),
    });

    res.json(restored);
  } catch (error) {
    console.error('Error restoring user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
