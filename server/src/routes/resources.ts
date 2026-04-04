import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { upload } from '../middleware/upload';

const router = Router();

// GET /api/resources
router.get('/', async (req, res) => {
  try {
    const { department } = req.query;
    const where: any = {};
    if (department) where.department = department;

    const resources = await prisma.resource.findMany({ where });
    res.json(resources);
  } catch (error) {
    console.error('Error fetching resources:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/resources
router.post('/', verifyToken as any, upload.single('file'), async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const { department, type, title, description, url } = req.body;
    let imageUrl = req.body.imageUrl;
    let fileUrl = req.body.fileUrl;
    let fileName = req.body.fileName;

    if (!title || !department) {
      return res.status(400).json({ error: 'title y department son requeridos' });
    }

    // Route the uploaded file correctly depending on resource type:
    //   image  → store as imageUrl (it IS the visual content)
    //   others → store as fileUrl  (downloadable attachment)
    if (req.file) {
      const uploadedPath = `/uploads/${req.file.filename}`;
      if (type === 'image') {
        imageUrl = uploadedPath;
      } else {
        fileUrl = uploadedPath;
        fileName = req.file.originalname;
      }
    }

    const resource = await prisma.resource.create({
      data: {
        department,
        type: type || 'articulo',
        title,
        description: description || '',
        url: url || '#',
        imageUrl,
        fileUrl,
        fileName
      }
    });

    res.status(201).json(resource);
  } catch (error) {
    console.error('Error creating resource:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PATCH /api/resources/:id
router.patch('/:id', verifyToken as any, upload.single('file'), async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    const { department, type, title, description, url } = req.body;
    const data: any = {};
    if (department !== undefined)   data.department = department;
    if (type !== undefined)         data.type = type;
    if (title !== undefined)        data.title = title;
    if (description !== undefined)  data.description = description;
    if (url !== undefined)          data.url = url;
    if (req.body.imageUrl !== undefined) data.imageUrl = req.body.imageUrl;

    if (req.file) {
      const uploadedPath = `/uploads/${req.file.filename}`;
      if (type === 'image') {
        data.imageUrl = uploadedPath;
      } else {
        data.fileUrl = uploadedPath;
        data.fileName = req.file.originalname;
      }
    }

    const resource = await prisma.resource.update({ where: { id: req.params.id as string }, data });
    res.json(resource);
  } catch (error) {
    console.error('Error updating resource:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/resources/:id
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  try {
    await prisma.resource.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
