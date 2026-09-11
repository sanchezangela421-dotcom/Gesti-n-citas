import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow } from './helpers/factories';

/**
 * Un especialista no puede acabar con dos citas vivas en el mismo horario.
 *
 * La comprobación de la ruta (`findFirst` y, si no hay choque, `create`) NO basta
 * por sí sola: PostgreSQL corre en READ COMMITTED, donde una transacción no ve lo
 * que otra todavía no confirmó, así que dos peticiones simultáneas la pasaban las
 * dos. Lo que cierra la carrera es el índice único parcial
 * `Appointment_active_slot_key` (migración 20260906000000).
 *
 * Estas pruebas disparan las peticiones DE VERDAD en paralelo (`Promise.all`, sin
 * await entre medias); secuencialmente pasarían incluso con el bug presente.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function scenario() {
  const org = await createOrg();
  const { specialist } = await createSpecialist({ organizationId: org.id });
  return { org, specialist };
}

/** Cuerpo de reserva para el hueco indicado. */
function booking(specialistId: string, date: string, time: string) {
  return {
    specialistId,
    date,
    time,
    modality: 'Virtual',
    motivo: 'Prueba de concurrencia',
  };
}

describe('carrera al reservar el mismo horario', () => {
  it('con 5 alumnos pidiendo el mismo hueco a la vez, solo uno lo obtiene', async () => {
    const { org, specialist } = await scenario();
    const date = isoDaysFromNow(7);
    const time = '10:00';

    const students = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        createUser({ organizationId: org.id, name: `Alumno ${i}` }),
      ),
    );

    // Todas salen a la vez: es la única forma de reproducir la carrera.
    const results = await Promise.all(
      students.map(s =>
        api('POST', '/api/appointments', {
          token: tokenFor(s),
          body: booking(specialist.id, date, time),
        }),
      ),
    );

    const creadas = results.filter(r => r.status === 201);
    const rechazadas = results.filter(r => r.status === 409);

    expect(creadas).toHaveLength(1);
    expect(rechazadas).toHaveLength(4);

    // Y lo que importa de verdad: la agenda del especialista quedó consistente.
    const vivas = await prisma.appointment.count({
      where: { specialistId: specialist.id, date, time, status: { not: 'Cancelada' } },
    });
    expect(vivas).toBe(1);
  });

  it('quien pierde la carrera recibe el mismo 409 que por el camino normal', async () => {
    const { org, specialist } = await scenario();
    const date = isoDaysFromNow(8);
    const time = '11:00';

    const [a, b] = await Promise.all([
      createUser({ organizationId: org.id }),
      createUser({ organizationId: org.id }),
    ]);

    const results = await Promise.all([
      api('POST', '/api/appointments', { token: tokenFor(a), body: booking(specialist.id, date, time) }),
      api('POST', '/api/appointments', { token: tokenFor(b), body: booking(specialist.id, date, time) }),
    ]);

    const rechazada = results.find(r => r.status === 409);
    expect(rechazada).toBeDefined();
    // Mensaje accionable, no un 500 genérico: quien pierde debe saber que elija otro.
    expect(rechazada!.body.error).toContain('horario');
  });

  it('cancelar libera el horario para otra persona', async () => {
    const { org, specialist } = await scenario();
    const date = isoDaysFromNow(9);
    const time = '12:00';

    const primero = await createUser({ organizationId: org.id });
    const segundo = await createUser({ organizationId: org.id });

    const creada = await api('POST', '/api/appointments', {
      token: tokenFor(primero), body: booking(specialist.id, date, time),
    });
    expect(creada.status).toBe(201);

    // Ocupado: el segundo no puede entrar todavía.
    const bloqueado = await api('POST', '/api/appointments', {
      token: tokenFor(segundo), body: booking(specialist.id, date, time),
    });
    expect(bloqueado.status).toBe(409);

    await api('PATCH', `/api/appointments/${creada.body.id}/status`, {
      token: tokenFor(primero), body: { status: 'Cancelada', notes: 'Ya no puedo' },
    });

    // El índice es PARCIAL justo para esto: una cancelación no puede dejar el
    // hueco muerto para siempre.
    const reintento = await api('POST', '/api/appointments', {
      token: tokenFor(segundo), body: booking(specialist.id, date, time),
    });
    expect(reintento.status).toBe(201);
  });

  it('dos citas canceladas pueden coexistir en el mismo horario', async () => {
    const { org, specialist } = await scenario();
    const date = isoDaysFromNow(10);
    const time = '13:00';

    const s1 = await createUser({ organizationId: org.id });
    const s2 = await createUser({ organizationId: org.id });

    // Se insertan directas: es el estado que deja el historial tras dos
    // cancelaciones sucesivas del mismo hueco, y el índice no debe estorbarlo.
    await createAppointment({ student: s1, specialist, organizationId: org.id, status: 'Cancelada', date, time });
    await createAppointment({ student: s2, specialist, organizationId: org.id, status: 'Cancelada', date, time });

    const canceladas = await prisma.appointment.count({
      where: { specialistId: specialist.id, date, time, status: 'Cancelada' },
    });
    expect(canceladas).toBe(2);
  });
});

describe('carrera al reagendar', () => {
  it('dos citas no pueden reagendarse al mismo hueco a la vez', async () => {
    const { org, specialist } = await scenario();
    const destinoDate = isoDaysFromNow(12);
    const destinoTime = '16:00';

    const s1 = await createUser({ organizationId: org.id });
    const s2 = await createUser({ organizationId: org.id });

    // Dos citas en horarios distintos, ambas del mismo especialista.
    const a1 = await createAppointment({
      student: s1, specialist, organizationId: org.id,
      status: 'Confirmada', date: isoDaysFromNow(11), time: '09:00',
    });
    const a2 = await createAppointment({
      student: s2, specialist, organizationId: org.id,
      status: 'Confirmada', date: isoDaysFromNow(11), time: '09:30',
    });

    // Las dos intentan mudarse al MISMO destino simultáneamente.
    const results = await Promise.all([
      api('PATCH', `/api/appointments/${a1.id}/reschedule`, {
        token: tokenFor(s1), body: { date: destinoDate, time: destinoTime },
      }),
      api('PATCH', `/api/appointments/${a2.id}/reschedule`, {
        token: tokenFor(s2), body: { date: destinoDate, time: destinoTime },
      }),
    ]);

    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(1);

    const enDestino = await prisma.appointment.count({
      where: { specialistId: specialist.id, date: destinoDate, time: destinoTime, status: { not: 'Cancelada' } },
    });
    expect(enDestino).toBe(1);
  });
});
