import { Router } from 'express';
import { prisma } from '../../db';
import { SuperAdminRequest } from '../../middleware/verifySuperAdmin';

const router = Router();

// GET /api/superadmin/stats
router.get('/', async (_req: SuperAdminRequest, res) => {
  try {
    const [
      totalOrgs,
      activeOrgs,
      totalUsers,
      totalAppointments,
      usersByRole,
      recentAudit,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { active: true } }),
      prisma.user.count(),
      prisma.appointment.count(),
      prisma.user.groupBy({
        by: ['role'],
        _count: { role: true },
      }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const roleMap = Object.fromEntries(
      usersByRole.map(r => [r.role, r._count.role])
    );

    res.json({
      orgs:         { total: totalOrgs, active: activeOrgs, inactive: totalOrgs - activeOrgs },
      users:        { total: totalUsers, byRole: roleMap },
      appointments: { total: totalAppointments },
      recentAudit,
    });
  } catch (error) {
    console.error('[superadmin] Error fetching stats:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
