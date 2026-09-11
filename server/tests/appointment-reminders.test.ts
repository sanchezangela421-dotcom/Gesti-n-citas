import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow } from './helpers/factories';
import { sendDueReminders } from '../src/services/appointmentReminders';

/**
 * Recordatorios de 24 h.
 *
 * Las plantillas existían desde hacía meses sin que nadie las llamara. Lo que se
 * prueba aquí es el planificador que faltaba: a quién recuerda, a quién no, y
 * sobre todo que **no manda el mismo recordatorio dos veces** — la propiedad que
 * lo hace seguro para correr cada hora y con varias instancias del servidor.
 */

// Se sustituye el envío real: la suite no debe depender de un SMTP, y así se
// puede afirmar EXACTAMENTE a quién se escribió.
const enviados: Array<{ studentEmail: string; specialistEmail: string; data: any }> = [];

vi.mock('../src/services/email', () => ({
  sendAppointmentReminderEmails: vi.fn(async (studentEmail: string, specialistEmail: string, data: any) => {
    enviados.push({ studentEmail, specialistEmail, data });
  }),
}));

// El import de `sendDueReminders` es estático (arriba) y aun así recibe el
// doble: Vitest eleva `vi.mock` por encima de los imports del archivo. Un
// `await import()` aquí no compila — bajo moduleResolution node16 los imports
// relativos exigirían extensión.

beforeEach(() => { enviados.length = 0; });

/** Escenario base: una cita Confirmada para mañana. */
async function citaManana(overrides: { status?: string; date?: string } = {}) {
  const org = await createOrg();
  const student = await createUser({ organizationId: org.id, name: 'Alumna' });
  const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id });
  const appt = await createAppointment({
    student, specialist, organizationId: org.id,
    status: overrides.status ?? 'Confirmada',
    date: overrides.date ?? isoDaysFromNow(1),
    time: '09:00',
  });
  return { org, student, specUser, specialist, appt };
}

describe('a quién se recuerda', () => {
  it('manda el recordatorio de una cita confirmada de mañana', async () => {
    const { student, specUser } = await citaManana();

    const r = await sendDueReminders();

    expect(r.enviados).toBe(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].studentEmail).toBe(student.email);
    expect(enviados[0].specialistEmail).toBe(specUser.email);
  });

  it('NO recuerda una cita todavía Pendiente', async () => {
    await citaManana({ status: 'Pendiente' });

    const r = await sendDueReminders();

    // Pendiente no es un acuerdo entre las dos partes: avisar de algo que el
    // especialista aún no aceptó confunde más de lo que ayuda.
    expect(r.candidatas).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('NO recuerda una cita cancelada', async () => {
    await citaManana({ status: 'Cancelada' });
    const r = await sendDueReminders();
    expect(enviados).toHaveLength(0);
    expect(r.candidatas).toBe(0);
  });

  it('NO recuerda citas de pasado mañana ni de hoy', async () => {
    await citaManana({ date: isoDaysFromNow(2) });
    await citaManana({ date: isoDaysFromNow(0) });

    const r = await sendDueReminders();

    expect(r.candidatas).toBe(0);
    expect(enviados).toHaveLength(0);
  });

  it('omite la cita si la organización está suspendida', async () => {
    const { org, appt } = await citaManana();
    await prisma.organization.update({ where: { id: org.id }, data: { active: false } });

    const r = await sendDueReminders();

    expect(r.omitidas).toBe(1);
    expect(enviados).toHaveLength(0);
    // Se marca igual, para no reevaluarla cada hora hasta que pase la fecha.
    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(after!.reminderSentAt).not.toBeNull();
  });

  it('omite la cita si el alumno fue dado de baja', async () => {
    const { student } = await citaManana();
    await prisma.user.update({ where: { id: student.id }, data: { deletedAt: new Date() } });

    const r = await sendDueReminders();

    expect(r.omitidas).toBe(1);
    expect(enviados).toHaveLength(0);
  });
});

describe('idempotencia (lo que lo hace seguro cada hora)', () => {
  it('dos pasadas seguidas mandan el recordatorio UNA sola vez', async () => {
    await citaManana();

    await sendDueReminders();
    const segunda = await sendDueReminders();

    expect(enviados).toHaveLength(1);
    expect(segunda.candidatas).toBe(0);
  });

  it('dos pasadas SIMULTÁNEAS mandan el recordatorio UNA sola vez', async () => {
    await citaManana();

    // Es el caso de varias instancias del servidor, o de una pasada que se
    // solapa consigo misma porque la anterior tardó más que el intervalo.
    await Promise.all([sendDueReminders(), sendDueReminders()]);

    expect(enviados).toHaveLength(1);
  });

  it('marca reminderSentAt al enviar', async () => {
    const { appt } = await citaManana();

    await sendDueReminders();

    const after = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(after!.reminderSentAt).toBeInstanceOf(Date);
  });
});

describe('contenido del recordatorio', () => {
  it('manda la fecha y la hora en formato legible, no crudas', async () => {
    await citaManana();

    await sendDueReminders();

    const { data } = enviados[0];
    // "2026-09-07" y "09:00" son ilegibles en un correo.
    expect(data.date).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.time).toMatch(/AM|PM/);
  });
});
