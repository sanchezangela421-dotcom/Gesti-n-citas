import { prisma } from '../db';
import { formatLongDate, formatTime12h } from '../lib/dates';
import {
  sendDepartmentDisabledUserEmail,
  sendDepartmentDisabledSpecialistEmail,
} from './email';

/**
 * Aviso de retirada de un departamento.
 *
 * Regla acordada: las citas ya agendadas SE RESPETAN y solo se bloquean las
 * nuevas. Por eso aquí no se cancela nada — únicamente se informa, para que
 * quien tiene una cita sepa que sigue en pie y que no podrá agendar otra.
 *
 * Se avisa a quien tiene una cita abierta en ese departamento y a sus
 * especialistas. Deliberadamente NO se escribe a toda la organización: serían
 * cientos de correos a gente que solo verá desaparecer una opción del selector.
 *
 * Fire-and-forget: el cambio ya está guardado y no debe revertirse porque falle
 * el SMTP.
 */
export function notifyDepartmentDisabled(
  org: { id: string; name: string },
  department: string,
): void {
  (async () => {
    const OPEN = ['Pendiente', 'Confirmada'];

    const openAppointments = await prisma.appointment.findMany({
      where: { organizationId: org.id, department, status: { in: OPEN } },
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      select: {
        studentId: true, date: true, time: true, specialistName: true,
      },
    });

    // La cita más próxima de cada persona: es la que se menciona en el correo.
    const nextByStudent = new Map<string, { date: string; time: string; specialistName: string }>();
    for (const a of openAppointments) {
      if (!nextByStudent.has(a.studentId)) {
        nextByStudent.set(a.studentId, { date: a.date, time: a.time, specialistName: a.specialistName });
      }
    }

    const timeNow = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    // ── Usuarios con cita abierta ────────────────────────────────────────────
    if (nextByStudent.size > 0) {
      const students = await prisma.user.findMany({
        where: { id: { in: [...nextByStudent.keys()] }, deletedAt: null },
        select: { id: true, name: true, email: true },
      });

      await prisma.notification.createMany({
        data: students.map(s => ({
          userId: s.id,
          title: `${department} deja de estar disponible`,
          message: `${org.name} dejará de ofrecer ${department}. Tu cita ya agendada se mantiene sin cambios, pero no podrás agendar nuevas citas en este departamento.`,
          time: timeNow,
          type: 'info',
          organizationId: org.id,
        })),
      });

      // En serie: el proveedor SMTP limita el ritmo de envío.
      for (const s of students) {
        const pending = nextByStudent.get(s.id);
        try {
          await sendDepartmentDisabledUserEmail(s.email, s.name, {
            department,
            orgName: org.name,
            pending: pending && {
              date: formatLongDate(pending.date),
              time: formatTime12h(pending.time),
              specialistName: pending.specialistName,
            },
          });
        } catch (err) {
          console.error(`[departmentNotices] Error avisando al usuario ${s.id}:`, err);
        }
      }
    }

    // ── Especialistas del departamento retirado ──────────────────────────────
    const specialists = await prisma.specialist.findMany({
      where: { organizationId: org.id, department, deletedAt: null },
      select: { id: true, name: true, userId: true, user: { select: { email: true, deletedAt: true } } },
    });

    const openBySpecialist = await prisma.appointment.groupBy({
      by: ['specialistId'],
      where: { organizationId: org.id, department, status: { in: OPEN } },
      _count: { _all: true },
    });
    const openCount = new Map(openBySpecialist.map(g => [g.specialistId, g._count._all]));

    const activeSpecialists = specialists.filter(s => !s.user.deletedAt);
    if (activeSpecialists.length > 0) {
      await prisma.notification.createMany({
        data: activeSpecialists.map(s => ({
          userId: s.userId,
          title: `${department} deja de estar disponible`,
          message: `${org.name} dejará de ofrecer ${department}. No recibirás solicitudes nuevas, pero conservas tu acceso y tus citas ya agendadas.`,
          time: timeNow,
          type: 'info',
          organizationId: org.id,
        })),
      });

      for (const s of activeSpecialists) {
        try {
          await sendDepartmentDisabledSpecialistEmail(s.user.email, s.name, {
            department,
            orgName: org.name,
            openAppointments: openCount.get(s.id) ?? 0,
          });
        } catch (err) {
          console.error(`[departmentNotices] Error avisando al especialista ${s.id}:`, err);
        }
      }
    }
  })().catch(err => console.error('[departmentNotices] Error notificando la retirada del departamento:', err));
}
