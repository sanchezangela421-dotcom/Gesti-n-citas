import { Router } from 'express';
import { prisma } from '../db';
import { verifyToken, AuthRequest } from '../middleware/verifyToken';

const router = Router();

// GET /api/stats
router.get('/', verifyToken as any, async (req: AuthRequest, res) => {
  try {
    const totalAppointments = await prisma.appointment.count();
    const pendientes = await prisma.appointment.count({ where: { status: 'Pendiente' } });
    const confirmadas = await prisma.appointment.count({ where: { status: 'Confirmada' } });
    const completadas = await prisma.appointment.count({ where: { status: 'Completada' } });
    const canceladas = await prisma.appointment.count({ where: { status: 'Cancelada' } });

    // Citas por departamento
    const byDept: any = {};
    const depts = ['Psicología', 'Tutorías', 'Nutrición'];
    for (const dept of depts) {
      byDept[dept] = await prisma.appointment.count({ where: { department: dept } });
    }

    // Datos para la gráfica mensual (últimos 3 meses reales o vacíos si no hay)
    // Para simplificar, agruparemos las citas reales de la DB por mes
    const appointments = await prisma.appointment.findMany({
      select: { date: true, department: true }
    });

    const monthlyMap: Record<string, any> = {};
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

    appointments.forEach(appt => {
      const date = new Date(appt.date + "T12:00:00");
      const monthKey = monthNames[date.getMonth()];
      if (!monthlyMap[monthKey]) {
        monthlyMap[monthKey] = { month: monthKey, Psicología: 0, Tutorías: 0, Nutrición: 0 };
      }
      if (monthlyMap[monthKey].hasOwnProperty(appt.department)) {
        monthlyMap[monthKey][appt.department]++;
      }
    });

    // Motivos frecuentes (reales de la DB - manejando nulls)
    const rawMotivos = await prisma.appointment.groupBy({
      by: ['motivo'],
      _count: { motivo: true },
      orderBy: { _count: { motivo: 'desc' } },
      take: 8
    });
    
    const chartMotivos = rawMotivos.map(m => ({
      name: m.motivo || "Consulta General",
      value: m._count.motivo || 0
    }));

    // Modalidad (real de la DB)
    const rawModalidades = await prisma.appointment.groupBy({
      by: ['modality'],
      _count: { modality: true }
    });
    
    const chartModalidades = rawModalidades.map(m => ({
      name: m.modality || "No especificada",
      value: m._count.modality || 0
    }));

    // Por Carrera - limitado a las mejores 8 para escalabilidad
    const apptsWithStudents = await prisma.appointment.findMany({
      select: { 
        studentId: true 
      }
    });

    const careerMap: Record<string, number> = {};
    
    // Obtener carreras de los alumnos que tienen citas
    const studentIds = [...new Set(apptsWithStudents.map(a => a.studentId))];
    const registeredStudents = await prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { carrera: true }
    });

    registeredStudents.forEach(s => {
      const careerName = s.carrera || "Otras / No especificada";
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
        byDept
      },
      charts: {
        monthly: Object.values(monthlyMap),
        motivos: chartMotivos,
        modalidad: chartModalidades,
        carrera: chartCarreras
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

export default router;
