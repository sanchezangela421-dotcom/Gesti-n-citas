import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow } from './helpers/factories';

/**
 * `GET /specialists/:id/available-days` — qué días del rango tienen hueco.
 *
 * Existe para que el navegador deje de preguntar día por día: el asistente de
 * nueva cita disparaba ~60 peticiones por especialista y mes, y con el límite de
 * 500 cada 15 min un alumno comparando especialistas agotaba su propia cuota.
 *
 * La regla que más importa aquí es la COHERENCIA con `available-slots`: si un
 * día sale en esta lista, abrirlo tiene que ofrecer horarios. Si divergen, el
 * alumno pulsa un día disponible y se encuentra la nada.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function ctx() {
  const org = await createOrg();
  const student = await createUser({ organizationId: org.id });
  const { specialist } = await createSpecialist({ organizationId: org.id });
  return { org, student, specialist };
}

/** Horario publicado en una fecha concreta. */
function slotOn(specialistId: string, specificDate: string, startTime: string, endTime: string) {
  return prisma.scheduleSlot.create({
    data: {
      specialistId,
      dayOfWeek: new Date(specificDate + 'T12:00:00').getDay(),
      startTime, endTime,
      available: true,
      specificDate,
    },
  });
}

function days(specialistId: string, token: string | null, from: string, to: string) {
  return api<string[]>('GET', `/api/specialists/${specialistId}/available-days?from=${from}&to=${to}`, { token });
}

describe('días con hueco', () => {
  it('devuelve solo los días que tienen horario publicado', async () => {
    const { student, specialist } = await ctx();
    const conHueco = isoDaysFromNow(5);
    await slotOn(specialist.id, conHueco, '09:00', '10:00');

    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(1), isoDaysFromNow(20));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([conHueco]);
  });

  it('un día cuyo único horario ya está reservado NO aparece', async () => {
    const { org, student, specialist } = await ctx();
    const date = isoDaysFromNow(6);
    await slotOn(specialist.id, date, '09:00', '10:00');
    await createAppointment({
      student, specialist, organizationId: org.id,
      status: 'Confirmada', date, time: '09:00',
    });

    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(1), isoDaysFromNow(20));
    expect(res.body).toEqual([]);
  });

  it('si queda otro horario libre, el día sigue apareciendo', async () => {
    const { org, student, specialist } = await ctx();
    const date = isoDaysFromNow(6);
    await slotOn(specialist.id, date, '09:00', '10:00');
    await slotOn(specialist.id, date, '11:00', '12:00');
    await createAppointment({
      student, specialist, organizationId: org.id,
      status: 'Confirmada', date, time: '09:00',
    });

    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(1), isoDaysFromNow(20));
    expect(res.body).toEqual([date]);
  });

  it('una cita CANCELADA no bloquea el día', async () => {
    const { org, student, specialist } = await ctx();
    const date = isoDaysFromNow(7);
    await slotOn(specialist.id, date, '09:00', '10:00');
    await createAppointment({
      student, specialist, organizationId: org.id,
      status: 'Cancelada', date, time: '09:00',
    });

    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(1), isoDaysFromNow(20));
    expect(res.body).toEqual([date]);
  });

  it('no devuelve días fuera del rango pedido', async () => {
    const { student, specialist } = await ctx();
    await slotOn(specialist.id, isoDaysFromNow(3), '09:00', '10:00');
    await slotOn(specialist.id, isoDaysFromNow(40), '09:00', '10:00');

    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(1), isoDaysFromNow(10));
    expect(res.body).toEqual([isoDaysFromNow(3)]);
  });

  it('nunca devuelve fechas pasadas, aunque el rango las incluya', async () => {
    const { student, specialist } = await ctx();
    await slotOn(specialist.id, isoDaysFromNow(-3), '09:00', '10:00');

    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(-10), isoDaysFromNow(10));
    expect(res.body).toEqual([]);
  });
});

describe('coherencia con available-slots', () => {
  it('todo día devuelto ofrece al menos un horario al abrirlo', async () => {
    const { org, student, specialist } = await ctx();
    const token = tokenFor(student);

    const d1 = isoDaysFromNow(4);
    const d2 = isoDaysFromNow(5);
    await slotOn(specialist.id, d1, '09:00', '10:00');
    await slotOn(specialist.id, d2, '08:00', '09:00');
    await slotOn(specialist.id, d2, '10:00', '11:00');
    await createAppointment({
      student, specialist, organizationId: org.id,
      status: 'Confirmada', date: d2, time: '08:00',
    });

    const listados = (await days(specialist.id, token, isoDaysFromNow(1), isoDaysFromNow(20))).body;
    expect(listados.length).toBeGreaterThan(0);

    // Es la garantía que sostiene el calendario: nada de días marcados como
    // disponibles que al abrirse están vacíos.
    for (const date of listados) {
      const slots = await api<{ start: string }[]>(
        'GET', `/api/specialists/${specialist.id}/available-slots?date=${date}`, { token },
      );
      expect(slots.status).toBe(200);
      expect(slots.body.length).toBeGreaterThan(0);
    }
  });
});

describe('validación y aislamiento', () => {
  it('exige from y to', async () => {
    const { student, specialist } = await ctx();
    const res = await api('GET', `/api/specialists/${specialist.id}/available-days`, { token: tokenFor(student) });
    expect(res.status).toBe(400);
  });

  it('rechaza un rango invertido', async () => {
    const { student, specialist } = await ctx();
    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(20), isoDaysFromNow(1));
    expect(res.status).toBe(422);
  });

  it('rechaza un rango desmedido', async () => {
    const { student, specialist } = await ctx();
    // Sin tope, pedir un año entero convierte la ruta en un modo de abuso.
    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(1), isoDaysFromNow(400));
    expect(res.status).toBe(422);
  });

  it('un alumno de otra organización no ve la agenda', async () => {
    const { specialist } = await ctx();
    const otraOrg = await createOrg();
    const intruso = await createUser({ organizationId: otraOrg.id });

    const res = await days(specialist.id, tokenFor(intruso), isoDaysFromNow(1), isoDaysFromNow(20));
    expect(res.status).toBe(404);
  });

  it('un especialista inactivo no ofrece días', async () => {
    const { student, specialist } = await ctx();
    await slotOn(specialist.id, isoDaysFromNow(5), '09:00', '10:00');
    await prisma.specialist.update({ where: { id: specialist.id }, data: { active: false } });

    const res = await days(specialist.id, tokenFor(student), isoDaysFromNow(1), isoDaysFromNow(20));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('exige autenticación', async () => {
    const { specialist } = await ctx();
    const res = await days(specialist.id, null, isoDaysFromNow(1), isoDaysFromNow(20));
    expect(res.status).toBe(401);
  });
});
