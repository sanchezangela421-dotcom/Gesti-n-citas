import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';
import { orgScope } from '../lib/orgScope';

const router = Router();

const UNSPECIFIED_CAREER = 'Otras / No especificada';

/**
 * Carrera de un alumno.
 *
 * Se lee la columna legacy `carrera` y, si está vacía, el campo dinámico del
 * mismo nombre en `metadata`: las organizaciones definen sus propios campos de
 * registro (RegistrationField), y solo las que usan la clave `carrera` llenan
 * además la columna. Sin este respaldo, los alumnos dados de alta por otras
 * vías caían todos en "no especificada".
 */
function careerOf(user: { carrera: string | null; metadata: unknown }): string {
  if (user.carrera?.trim()) return user.carrera.trim();
  const meta = user.metadata as Record<string, unknown> | null;
  const fromMeta = meta && typeof meta.carrera === 'string' ? meta.carrera.trim() : '';
  return fromMeta || UNSPECIFIED_CAREER;
}

// GET /api/stats?periodId=<id>
// Si se pasa periodId, filtra las citas de ese período.
// Si no se pasa, devuelve estadísticas globales (todos los períodos).
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const { periodId } = req.query;
    const scope = orgScope(req.user);
    const where: any = periodId === 'unassigned'
      ? { ...scope, periodId: null }
      : periodId
        ? { ...scope, periodId: periodId as string }
        : { ...scope };

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

    // Por carrera — se cuentan CITAS, no alumnos distintos.
    //
    // Antes se deduplicaban los studentId y se contaba uno por alumno, de modo
    // que la misma gráfica daba números distintos según se leyera del servidor
    // o del cálculo propio del panel de admin (que sí cuenta citas). El resto
    // de gráficas de este endpoint cuentan citas, así que esta se alinea.
    const apptStudents = await prisma.appointment.findMany({
      where,
      select: { studentId: true },
    });
    const students = await prisma.user.findMany({
      where: { id: { in: [...new Set(apptStudents.map(a => a.studentId))] } },
      select: { id: true, carrera: true, metadata: true },
    });
    const careerByStudent = new Map(students.map(s => [s.id, careerOf(s)]));

    const careerMap: Record<string, number> = {};
    for (const a of apptStudents) {
      const careerName = careerByStudent.get(a.studentId) ?? UNSPECIFIED_CAREER;
      careerMap[careerName] = (careerMap[careerName] || 0) + 1;
    }
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
