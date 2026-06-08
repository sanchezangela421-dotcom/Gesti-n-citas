import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// GET /api/public/organizations
// Lista orgs activas para el selector de registro — no requiere autenticación
router.get('/organizations', async (_req, res) => {
  try {
    const orgs = await prisma.organization.findMany({
      where: { active: true },
      select: { id: true, name: true, slug: true, type: true, userRoleLabel: true, logoUrl: true },
      orderBy: { name: 'asc' },
    });
    res.json(orgs);
  } catch (error) {
    console.error('[public] Error fetching organizations:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/public/organizations/:slug/fields
// Devuelve los campos de registro de una org — no requiere autenticación
router.get('/organizations/:slug/fields', async (req, res) => {
  try {
    const slug = req.params.slug as string;

    const org = await prisma.organization.findUnique({
      where: { slug },
      select: {
        id: true, name: true, userRoleLabel: true,
        registrationFields: {
          orderBy: { order: 'asc' },
          select: {
            key: true, label: true, type: true,
            required: true, options: true, placeholder: true, order: true,
          },
        },
      },
    });

    if (!org) return res.status(404).json({ error: 'Organización no encontrada' });

    res.json(org);
  } catch (error) {
    console.error('[public] Error fetching org fields:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
