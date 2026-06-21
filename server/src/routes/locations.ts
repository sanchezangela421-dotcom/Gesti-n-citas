import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';

const router = Router();

const isManager = (role?: string) => role === 'admin' || role === 'superadmin';

// ── GET /api/locations ────────────────────────────────────────────────────────
// Sedes de la organización (para selectores). Por defecto solo las activas;
// el admin puede pedir todas con ?all=1.
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const where: any = { ...orgScope(req.user) };
    if (!(isManager(req.user?.role) && req.query.all === '1')) where.active = true;
    const locations = await prisma.orgLocation.findMany({ where, orderBy: { name: 'asc' } });
    res.json(locations);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── POST /api/locations ───────────────────────────────────────────────────────
router.post('/', verifyToken as any, async (req: AuthRequest, res) => {
  if (!isManager(req.user?.role)) return res.status(403).json({ error: 'Sin permisos' });
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const address = typeof req.body?.address === 'string' ? req.body.address.trim() : '';
    if (!name) return res.status(400).json({ error: 'El nombre de la sede es requerido' });

    const location = await prisma.orgLocation.create({
      data: { name, address: address || null, organizationId: req.user?.organizationId ?? null },
    });
    res.status(201).json(location);
  } catch (error) {
    console.error('Error creating location:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── PATCH /api/locations/:id ──────────────────────────────────────────────────
router.patch('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  if (!isManager(req.user?.role)) return res.status(403).json({ error: 'Sin permisos' });
  try {
    const id = req.params.id as string;
    const existing = await prisma.orgLocation.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!existing) return res.status(404).json({ error: 'Sede no encontrada' });

    const data: any = {};
    if (typeof req.body?.name === 'string') data.name = req.body.name.trim();
    if (req.body?.address !== undefined) data.address = (typeof req.body.address === 'string' ? req.body.address.trim() : '') || null;
    if (req.body?.active !== undefined) data.active = !!req.body.active;

    const updated = await prisma.orgLocation.update({ where: { id }, data });
    res.json(updated);
  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ── DELETE /api/locations/:id ─────────────────────────────────────────────────
// Los especialistas que la tenían asignada quedan sin sede (FK SetNull).
router.delete('/:id', verifyToken as any, async (req: AuthRequest, res) => {
  if (!isManager(req.user?.role)) return res.status(403).json({ error: 'Sin permisos' });
  try {
    const id = req.params.id as string;
    const existing = await prisma.orgLocation.findFirst({ where: { id, ...orgScope(req.user) } });
    if (!existing) return res.status(404).json({ error: 'Sede no encontrada' });

    await prisma.orgLocation.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
