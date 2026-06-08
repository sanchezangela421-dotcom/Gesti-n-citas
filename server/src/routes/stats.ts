import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';

const router = Router();

function orgFilter(req: AuthRequest) {
  if (req.user?.role === 'superadmin') return {};
  return req.user?.organizationId ? { organizationId: req.user.organizationId } : {};
}

// GET /api/stats?periodId=<id>
// Si se pasa periodId, filtra las citas de ese período.
// Si no se pasa, devuelve estadísticas globales (todos los períodos).
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const { periodId } = req.query;
    const orgScope = orgFilter(req);
    const where: any = periodId === 'unassigned'
      ? { ...orgScope, periodId: null }
      : periodId
        ? { ...orgScope, periodId: periodId as string }
        : { ...orgScope };

    const [totalAppointments, pendientes, confirmadas, completadas, canceladas] =
      await Promise.all([
        prisma.appointment.count({ where }),
        prisma.appointment.count({ where: { ...where, status: 'Pendiente' } }),
        prisma.appointment.count({ where: { ...where, status: 'Confirmada' } }),
        prisma.appointment.count({ where: { ...where, status: 'Completada' } }),
        prisma.appointment.count({ where: { ...where, status: 'Cancelada' } }),
      ]);

    // Citas por departamento
    const depts = ['Psicología', 'Tutorías', 'Nutrición'];
    const byDeptEntries = await Promise.all(
      depts.map(dept =>
        prisma.appointment.count({ where: { ...where, department: dept } }).then(n => [dept, n])
      )
    );
    const byDept = Object.fromEntries(byDeptEntries);

    // Gráfica mensual — agrupa por "Mes YYYY" para evitar colisiones entre años
    const appointments = await prisma.appointment.findMany({
      where,
      select: { date: true, department: true },
    });

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                        'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const monthlyMap: Record<string, any> = {};

    appointments.forEach(appt => {
      const date = new Date(appt.date + 'T12:00:00');
      const year = date.getFullYear();
      const monthKey = `${monthNames[date.getMonth()]} ${year}`;
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = {
          month: monthKey,
          _sortKey: year * 100 + date.getMonth(),
          Psicología: 0,
          Tutorías: 0,
          Nutrición: 0,
        };
      }
      if (Object.prototype.hasOwnProperty.call(monthlyMap[monthKey], appt.department)) {
        monthlyMap[monthKey][appt.department]++;
      }
    });

    // Ordenar cronológicamente
    const monthly = Object.values(monthlyMap)
      .sort((a: any, b: any) => a._sortKey - b._sortKey)
      .map(({ _sortKey, ...rest }: any) => rest);

    // Motivos frecuentes
    const rawMotivos = await prisma.appointment.groupBy({
      by: ['motivo'],
      where,
      _count: { motivo: true },
      orderBy: { _count: { motivo: 'desc' } },
      take: 8,
    });
    const chartMotivos = rawMotivos.map(m => ({
      name: m.motivo || 'Consulta General',
      value: m._count.motivo || 0,
    }));

    // Modalidad
    const rawModalidades = await prisma.appointment.groupBy({
      by: ['modality'],
      where,
      _count: { modality: true },
    });
    const chartModalidades = rawModalidades.map(m => ({
      name: m.modality || 'No especificada',
      value: m._count.modality || 0,
    }));

    // Por carrera
    const apptsWithStudents = await prisma.appointment.findMany({
      where,
      select: { studentId: true },
    });
    const studentIds = [...new Set(apptsWithStudents.map(a => a.studentId))];
    const registeredStudents = await prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { carrera: true },
    });
    const careerMap: Record<string, number> = {};
    registeredStudents.forEach(s => {
      const careerName = s.carrera || 'Otras / No especificada';
      careerMap[careerName] = (careerMap[careerName] || 0) + 1;
    });
    const chartCarreras = Object.entries(careerMap)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    res.json({
      summary: {
        total: totalAppointments,
        pendientes,
        confirmadas,
        completadas,
        canceladas,
        byDept,
      },
      charts: {
        monthly,
        motivos: chartMotivos,
        modalidad: chartModalidades,
        carrera: chartCarreras,
      },
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
