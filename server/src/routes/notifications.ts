import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';

const router = Router();

// GET /api/notifications — notificaciones del usuario autenticado
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(notifications);
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/notifications — crear notificación (solo admin)
router.post('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Sin permisos' });
    }
    const { userId, title, message, type } = req.body;
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
        time: new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
        read: false,
      },
    });
    res.status(201).json(notification);
  } catch (error) {
    console.error('Error creating notification:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/notifications/read-all — marcar todas como leídas
router.patch('/read-all', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error marking notifications read:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/notifications/all — eliminar todas del usuario
router.delete('/all', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    await prisma.notification.deleteMany({ where: { userId } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error clearing notifications:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/notifications/:id — eliminar una notificación
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;
    await prisma.notification.deleteMany({ where: { id, userId } });
    res.json({ ok: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
