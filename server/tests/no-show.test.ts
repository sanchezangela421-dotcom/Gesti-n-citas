import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor, waitFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow } from './helpers/factories';

/**
 * Registro de inasistencias.
 *
 * Hasta ahora una cita solo podía acabar Completada o Cancelada, así que "el
 * usuario no vino" era indistinguible de "el especialista olvidó cerrarla".
 * Sin ese dato no hay forma de medir nada sobre asistencia.
 */

const MISSED = 'No asistió';

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function scenario() {
  const org = await createOrg();
  const student = await createUser({ organizationId: org.id });
  const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id });
  const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
  return { org, student, specUser, specialist, admin };
}

/** Cita confirmada cuya hora ya pasó — el caso donde aplica la inasistencia. */
async function pastConfirmed(ctx: Awaited<ReturnType<typeof scenario>>) {
  return createAppointment({
    student: ctx.student, specialist: ctx.specialist, organizationId: ctx.org.id,
    status: 'Confirmada', date: isoDaysFromNow(-2), time: '10:00',
  });
}

describe('transiciones', () => {
  it('una cita confirmada y vencida se puede marcar como no asistida', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(MISSED);
  });

  it('NO se puede marcar desde Pendiente', async () => {
    const ctx = await scenario();
    // Nunca se confirmó: el usuario pudo no saber siquiera que la cita seguía en pie,
    // así que registrarle una falta le cargaría un incumplimiento ajeno.
    const appt = await createAppointment({
      student: ctx.student, specialist: ctx.specialist, organizationId: ctx.org.id,
      status: 'Pendiente', date: isoDaysFromNow(-2),
    });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED },
    });
    expect(res.status).toBe(422);
  });

  it('es un estado terminal', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);
    await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED },
    });

    for (const status of ['Completada', 'Cancelada', 'Confirmada']) {
      const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
        token: tokenFor(ctx.specUser), body: { status, notes: 'x' },
      });
      expect(res.status).toBe(422);
    }
  });
});

describe('quién y cuándo', () => {
  it('el usuario no puede marcarse a sí mismo como no asistido', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.student), body: { status: MISSED },
    });

    // Se corta antes, en la regla de que el usuario final solo puede cancelar
    expect(res.status).toBe(403);
    const still = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(still!.status).toBe('Confirmada');
  });

  it('el admin sí puede registrarla', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.admin), body: { status: MISSED },
    });
    expect(res.status).toBe(200);
  });

  it('no se puede marcar antes de la hora de la cita', async () => {
    const ctx = await scenario();
    const futura = await createAppointment({
      student: ctx.student, specialist: ctx.specialist, organizationId: ctx.org.id,
      status: 'Confirmada', date: isoDaysFromNow(3), time: '10:00',
    });

    const res = await api('PATCH', `/api/appointments/${futura.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED },
    });

    expect(res.status).toBe(422);
    const still = await prisma.appointment.findUnique({ where: { id: futura.id } });
    expect(still!.status).toBe('Confirmada');
  });

  it('un especialista no puede marcarla en la cita de otro', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);
    const { user: ajeno } = await createSpecialist({ organizationId: ctx.org.id });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ajeno), body: { status: MISSED },
    });
    expect(res.status).toBe(403);
  });
});

describe('efectos', () => {
  it('avisa al usuario para que sepa que la cita ya no está en pie', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);

    await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED },
    });

    const avisos = await waitFor(
      async () => {
        const n = await prisma.notification.findMany({ where: { userId: ctx.student.id } });
        return n.length > 0 ? n : null;
      },
      { label: 'el aviso de inasistencia' },
    );
    // El mensaje invita a volver a agendar, no reprocha
    expect(avisos[0].message).toContain('agendar una nueva');
  });

  it('no escribe nota clínica: no hubo sesión que anotar', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);

    await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED, notes: 'no vino' },
    });

    expect(await prisma.clinicalNote.count({ where: { appointmentId: appt.id } })).toBe(0);
  });

  it('cuenta como categoría propia en las estadísticas', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);
    await createAppointment({
      student: ctx.student, specialist: ctx.specialist, organizationId: ctx.org.id,
      status: 'Completada', time: '12:00',
    });

    await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED },
    });

    const res = await api('GET', '/api/stats', { token: tokenFor(ctx.admin) });

    expect(res.body.summary.noAsistio).toBe(1);
    expect(res.body.summary.completadas).toBe(1);
    // No se contabiliza como cancelada: son cosas distintas
    expect(res.body.summary.canceladas).toBe(0);
    expect(res.body.summary.total).toBe(2);
  });

  it('libera el hueco solo en el sentido de que la cita ya está cerrada', async () => {
    const ctx = await scenario();
    const appt = await pastConfirmed(ctx);
    await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(ctx.specUser), body: { status: MISSED },
    });

    // La cita permanece en el historial: es justamente el dato que se quería tener
    const still = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(still).not.toBeNull();
    expect(still!.status).toBe(MISSED);
  });
});
