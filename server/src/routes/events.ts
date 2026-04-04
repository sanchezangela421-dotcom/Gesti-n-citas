import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { upload } from '../middleware/upload';

const router = Router();

// GET /api/events
router.get('/', async (req, res) => {
  try {
    const { department } = req.query;
    const where: any = {};
    if (department) where.department = department;

    const events = await prisma.appEvent.findMany({
      where,
      orderBy: { date: 'asc' }
    });
    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/events
router.post('/', verifyToken as any, upload.single('image'), async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const { title, description, department, date, time, type, registrationUrl } = req.body;
    let imageUrl = req.body.imageUrl;

    if (!title || !date || !department) {
      return res.status(400).json({ error: 'title, date y department son requeridos' });
    }

    // Si se subió una imagen vía multer
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    const event = await prisma.appEvent.create({
      data: { 
        title, 
        description: description || '', 
        department, 
        date, 
        time: time || '', 
        type: type || 'conferencia', 
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=400&q=80', 
        registrationUrl 
      }
    });

    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/events/:id
router.patch('/:id', verifyToken as any, upload.single('image'), async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const { title, description, department, date, time, type, registrationUrl } = req.body;
    const data: any = {};
    if (title !== undefined)           data.title = title;
    if (description !== undefined)     data.description = description;
    if (department !== undefined)      data.department = department;
    if (date !== undefined)            data.date = date;
    if (time !== undefined)            data.time = time;
    if (type !== undefined)            data.type = type;
    if (registrationUrl !== undefined) data.registrationUrl = registrationUrl;
    if (req.file)                      data.imageUrl = `/uploads/${req.file.filename}`;
    else if (req.body.imageUrl !== undefined) data.imageUrl = req.body.imageUrl;

    const event = await prisma.appEvent.update({ where: { id: req.params.id as string }, data });
    res.json(event);
  } catch (error) {
    console.error('Error updating event:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/events/:id
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    await prisma.appEvent.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
