import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { formatLongDate, formatTime12h } from '../lib/dates';
import {
  sendCancelledBySpecialistEmail,
  sendCancelledByStudentEmail,
} from './email';

/**
 * Baja de personas (especialistas y usuarios finales).
 *
 * Regla de oro: NADA se borra. La fila del usuario se conserva porque el
 * expediente clínico la referencia y su retención es obligatoria (NOM-004); la
 * baja solo marca `deletedAt` y corta el acceso.
 *
 * Lo único que sí cambia de estado son las citas ABIERTAS (Pendiente/Confirmada):
 * quedarían huérfanas —nadie puede atenderlas ni cancelarlas— así que se cancelan
 * dejando constancia del motivo. Las citas Completada y Cancelada no se tocan
 * jamás: son el historial que sostiene reportes, períodos y expediente.
 */

const OPEN_STATUSES = ['Pendiente', 'Confirmada'];

export interface CancelledAppointment {
  id: string;
  date: string;
  time: string;
  modality: string;
  department: string;
  studentId: string;
  studentName: string;
  specialistId: string;
  specialistName: string;
}

/**
 * Cancela dentro de la transacción las citas abiertas de la persona dada de baja
 * y devuelve las afectadas para poder avisar a la contraparte después del commit.
 */
export async function cancelOpenAppointments(
  tx: Prisma.TransactionClient,
  target: { studentId: string } | { specialistId: string },
  reason: string,
): Promise<CancelledAppointment[]> {
  const affected = await tx.appointment.findMany({
    where: { ...target, status: { in: OPEN_STATUSES } },
    select: {
      id: true, date: true, time: true, modality: true, department: true,
      studentId: true, studentName: true, specialistId: true, specialistName: true,
    },
  });

  if (affected.length === 0) return [];

  await tx.appointment.updateMany({
    where: { id: { in: affected.map(a => a.id) } },
    data: { status: 'Cancelada', cancellationReason: reason },
  });

  return affected;
}

/**
 * Avisa a la contraparte de cada cita cancelada por una baja: notificación in-app
 * (persistida por el servidor, no depende de que el navegador siga abierto) y correo.
 *
 * `audience` indica a quién hay que avisar, que siempre es el lado que NO fue dado
 * de baja: al dar de baja a un especialista se avisa a sus pacientes, y viceversa.
 *
 * Fire-and-forget: la baja ya está confirmada en BD y no debe revertirse porque
 * falle el SMTP. Los errores quedan en el log.
 */
export function notifyCancelledByDeactivation(
  appointments: CancelledAppointment[],
  audience: 'students' | 'specialists',
  reason: string,
  organizationId: string | null,
): void {
  if (appointments.length === 0) return;

  (async () => {
    // Resolver destinatarios: para el alumno el destinatario ya es un User.id, pero
    // para el especialista hay que traducir Specialist.id → User.id (y su correo).
    const recipientByAppt = new Map<string, { userId: string; email: string | null }>();

    if (audience === 'students') {
      const students = await prisma.user.findMany({
        where: { id: { in: [...new Set(appointments.map(a => a.studentId))] } },
        select: { id: true, email: true, deletedAt: true },
      });
      const byId = new Map(students.map(s => [s.id, s]));
      for (const a of appointments) {
        const s = byId.get(a.studentId);
        // Un alumno que también está dado de baja no recibe avisos
        if (s && !s.deletedAt) recipientByAppt.set(a.id, { userId: s.id, email: s.email });
      }
    } else {
      const specialists = await prisma.specialist.findMany({
        where: { id: { in: [...new Set(appointments.map(a => a.specialistId))] } },
        select: { id: true, userId: true, deletedAt: true, user: { select: { email: true, deletedAt: true } } },
      });
      const byId = new Map(specialists.map(s => [s.id, s]));
      for (const a of appointments) {
        const s = byId.get(a.specialistId);
        if (s && !s.deletedAt && !s.user.deletedAt) {
          recipientByAppt.set(a.id, { userId: s.userId, email: s.user.email });
        }
      }
    }

    const timeNow = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const rows = appointments.flatMap(a => {
      const to = recipientByAppt.get(a.id);
      if (!to) return [];
      return [{
        userId: to.userId,
        title: 'Cita cancelada',
        message: audience === 'students'
          ? `Tu cita de ${a.department} con ${a.specialistName} del ${formatLongDate(a.date)} a las ${formatTime12h(a.time)} fue cancelada. Motivo: ${reason}`
          : `La cita con ${a.studentName} del ${formatLongDate(a.date)} a las ${formatTime12h(a.time)} fue cancelada. Motivo: ${reason}`,
        time: timeNow,
        type: 'cancelled',
        organizationId,
      }];
    });

    if (rows.length > 0) await prisma.notification.createMany({ data: rows });

    // Correos en serie: el proveedor SMTP limita el ritmo de envío y una baja
    // puede arrastrar decenas de citas de golpe.
    for (const a of appointments) {
      const to = recipientByAppt.get(a.id);
      if (!to?.email) continue;
      const data = {
        date: formatLongDate(a.date),
        time: formatTime12h(a.time),
        specialistName: a.specialistName,
        studentName: a.studentName,
        department: a.department,
        modality: a.modality,
        reason,
      };
      try {
        if (audience === 'students') await sendCancelledBySpecialistEmail(to.email, data);
        else await sendCancelledByStudentEmail(to.email, data);
      } catch (err) {
        console.error(`[deactivation] Error enviando correo de cancelación (cita ${a.id}):`, err);
      }
    }
  })().catch(err => console.error('[deactivation] Error notificando cancelaciones:', err));
}
