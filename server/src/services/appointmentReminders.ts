import { prisma } from '../db';
import { localISODate, formatLongDate, formatTime12h } from '../lib/dates';
import { sendAppointmentReminderEmails } from './email';

/**
 * Recordatorios de cita 24 h antes.
 *
 * Las plantillas y `sendAppointmentReminderEmails` existían desde hacía meses,
 * pero nadie las llamaba: era código muerto. Esto es lo que faltaba — quien las
 * dispara.
 *
 * Solo se recuerdan las citas **Confirmadas**. Una cita Pendiente todavía no es
 * un acuerdo entre las dos partes, y avisar "tienes una cita mañana" de algo que
 * el especialista aún no aceptó genera más confusión que asistencia.
 */

/** Cada cuánto se revisa si hay recordatorios que mandar. */
const DEFAULT_INTERVAL_MINUTES = 60;

/** Tope por pasada, para que un arranque tras días caído no sature el SMTP. */
const MAX_PER_RUN = 200;

export interface ReminderRunResult {
  /** Citas que cumplían el criterio antes de filtrar. */
  candidatas: number;
  /** Recordatorios efectivamente enviados. */
  enviados: number;
  /** Citas descartadas (organización suspendida, alguna parte dada de baja, sin correo). */
  omitidas: number;
  /** Reclamadas pero cuyo envío falló. */
  fallidos: number;
}

/**
 * Envía los recordatorios de las citas de mañana que aún no lo tienen.
 *
 * Exportada aparte del planificador para poder ejercitarla en pruebas y para
 * poder dispararla a mano si hiciera falta, sin levantar un temporizador.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<ReminderRunResult> {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const targetDate = localISODate(tomorrow);

  const candidates = await prisma.appointment.findMany({
    where: {
      date: targetDate,
      status: 'Confirmada',
      reminderSentAt: null,
    },
    take: MAX_PER_RUN,
    include: {
      student: { select: { email: true, deletedAt: true } },
      specialist: {
        select: {
          deletedAt: true,
          user: { select: { email: true, deletedAt: true } },
        },
      },
      organization: { select: { active: true } },
    },
  });

  const result: ReminderRunResult = {
    candidatas: candidates.length, enviados: 0, omitidas: 0, fallidos: 0,
  };

  for (const appt of candidates) {
    const studentEmail = appt.student?.email;
    const specialistEmail = appt.specialist?.user?.email;

    // Una organización suspendida no debe seguir mandando correos en su nombre,
    // y a quien está dado de baja no se le escribe: su cuenta existe solo por
    // retención documental.
    const skip =
      !studentEmail ||
      !specialistEmail ||
      appt.student?.deletedAt !== null ||
      appt.specialist?.deletedAt !== null ||
      appt.specialist?.user?.deletedAt !== null ||
      (appt.organization !== null && !appt.organization.active);

    if (skip) {
      result.omitidas++;
      // Se marca igual: no vamos a reevaluarla cada hora hasta que pase la fecha.
      await prisma.appointment.updateMany({
        where: { id: appt.id, reminderSentAt: null },
        data: { reminderSentAt: new Date() },
      });
      continue;
    }

    // Reclamo atómico ANTES de enviar. `updateMany` con el filtro en NULL es lo
    // que serializa: si otra instancia (o una pasada solapada) ya se lo llevó,
    // aquí devuelve count 0 y esta se aparta. Reclamar después de enviar dejaría
    // una ventana en la que ambas mandan el mismo correo.
    const claimed = await prisma.appointment.updateMany({
      where: { id: appt.id, reminderSentAt: null },
      data: { reminderSentAt: new Date() },
    });
    if (claimed.count === 0) continue;

    try {
      await sendAppointmentReminderEmails(studentEmail, specialistEmail, {
        date: formatLongDate(appt.date),
        time: formatTime12h(appt.time),
        specialistName: appt.specialistName,
        studentName: appt.studentName,
        department: appt.department,
        modality: appt.modality,
        meetingUrl: appt.meetingUrl ?? undefined,
        location: appt.location ?? undefined,
      });
      result.enviados++;
    } catch (err) {
      // La marca NO se revierte a propósito. Reintentar arriesga un duplicado
      // (el primer correo pudo haber salido antes del fallo del segundo), y para
      // un recordatorio molestar dos veces es peor que perder uno. Queda en el
      // log para que se vea si el SMTP está caído.
      result.fallidos++;
      console.error(`[reminders] Falló el recordatorio de la cita ${appt.id}:`, err);
    }
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Arranca la revisión periódica. Idempotente: llamarla dos veces no crea dos
 * temporizadores.
 *
 * Se apaga con `REMINDERS_ENABLED=false` y nunca arranca bajo NODE_ENV=test (una
 * suite no debe mandar correos ni pelearse con un temporizador de fondo).
 */
export function startReminderScheduler(): void {
  if (timer) return;
  if (process.env.NODE_ENV === 'test') return;
  if (process.env.REMINDERS_ENABLED === 'false') {
    console.log('[reminders] Desactivados por REMINDERS_ENABLED=false');
    return;
  }

  const minutes = Number(process.env.REMINDERS_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES);
  const intervalMs = Math.max(1, minutes) * 60 * 1000;

  const run = () => {
    sendDueReminders()
      .then(r => {
        if (r.candidatas > 0) {
          console.log(
            `[reminders] ${r.enviados} enviados, ${r.omitidas} omitidos, ${r.fallidos} fallidos ` +
            `(de ${r.candidatas} candidatas)`,
          );
        }
      })
      .catch(err => console.error('[reminders] Error en la pasada:', err));
  };

  timer = setInterval(run, intervalMs);
  // `unref` para que un temporizador pendiente no impida que el proceso termine
  // al recibir una señal de apagado.
  timer.unref?.();

  console.log(`[reminders] Planificador activo — revisión cada ${minutes} min`);
  run(); // primera pasada al arrancar, sin esperar el primer intervalo
}

/** Detiene la revisión periódica (apagado ordenado y pruebas). */
export function stopReminderScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
