import { Router } from 'express';
import { prisma } from '../../db';
import { SuperAdminRequest } from '../../middleware/verifySuperAdmin';

const router = Router();
const PAGE_SIZE = 100;

// GET /api/superadmin/audit?orgId=&page=
router.get('/', async (req: SuperAdminRequest, res) => {
  try {
    const orgId = req.query.orgId as string | undefined;
    const page  = Math.max(1, parseInt((req.query.page as string) ?? '1'));

    const where = orgId ? { organizationId: orgId } : {};

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip:  (page - 1) * PAGE_SIZE,
        take:  PAGE_SIZE,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ entries, total, page, pageSize: PAGE_SIZE });
  } catch (error) {
    console.error('[superadmin] Error fetching audit log:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
