import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';

const router = Router();

// GET /api/users — role-based filtering
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const caller = req.user!;
    const where: any = {};

    if (caller.role === 'admin') {
      // Admin sees all; optional ?role= filter
      const role = req.query.role as string | undefined;
      if (role) where.role = role;
    } else if (caller.role === 'especialista') {
      // Specialists only need student data
      where.role = 'alumno';
    } else {
      // Students only see themselves
      where.id = caller.id;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, role: true,
        matricula: true, carrera: true, semestre: true,
        edad: true, genero: true, department: true,
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
    if (caller.role !== 'admin' && caller.id !== id) {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true, email: true, name: true, role: true,
        matricula: true, carrera: true, semestre: true,
        edad: true, genero: true, department: true
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
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }

    const id = req.params.id as string;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (user.email === 'admin@instituto.edu.mx') {
      return res.status(403).json({ error: 'No se puede eliminar el administrador principal' });
    }

    await prisma.user.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
