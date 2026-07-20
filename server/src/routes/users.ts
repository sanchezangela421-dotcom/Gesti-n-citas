import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';

const router = Router();

// GET /api/users — role-based filtering
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const caller = req.user!;
    const where: any = { ...orgScope(req.user) };

    if (caller.role === 'admin' || caller.role === 'superadmin') {
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
        fechaNacimiento: true, genero: true, department: true
      }
    });

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/users/:id — admin only
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    // El scope evita que un admin elimine usuarios de otra organización
    const user = await prisma.user.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Guarda por ROL (la anterior comparaba contra un email que ya no existe en el
    // seed, dejando al admin real sin protección). La gestión de cuentas admin se
    // hace desde el panel de superadmin, que tiene sus propias validaciones.
    if (user.role === 'admin' || user.role === 'superadmin') {
      return res.status(403).json({ error: 'Las cuentas de administrador no se pueden eliminar desde este panel' });
    }

    await prisma.user.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
