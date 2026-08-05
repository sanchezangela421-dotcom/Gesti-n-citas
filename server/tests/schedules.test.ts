import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, isoDaysFromNow } from './helpers/factories';

/**
 * Publicación de horarios y saneamiento de URLs.
 *
 * Los solapes se validaban solo en el navegador, así que dos pestañas abiertas
 * —o una llamada directa— creaban horarios encimados que el alumno veía
 * duplicados. Y `Resource.url` / `AppEvent.registrationUrl` entraban sin
 * validar, pese a que el frontend los abre.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function specialistCtx() {
  const org = await createOrg();
  const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id });
  const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
  return { org, specUser, specialist, admin };
}

/** Publica un horario; la fecha se toma a 7 días salvo que se indique otra. */
function postSlot(
  specialistId: string, token: string,
  slot: { startTime: string; endTime: string; specificDate?: string | null; dayOfWeek?: number },
) {
  return api('POST', `/api/specialists/${specialistId}/schedules`, {
    token,
    body: {
      dayOfWeek: slot.dayOfWeek ?? 1,
      startTime: slot.startTime,
      endTime: slot.endTime,
      specificDate: slot.specificDate === undefined ? isoDaysFromNow(7) : slot.specificDate,
    },
  });
}

describe('solapes de horarios', () => {
  it('rechaza un rango que se encima con otro del mismo día', async () => {
    const { specUser, specialist } = await specialistCtx();
    expect((await postSlot(specialist.id, tokenFor(specUser), { startTime: '09:00', endTime: '11:00' })).status).toBe(200);

    const res = await postSlot(specialist.id, tokenFor(specUser), { startTime: '10:00', endTime: '12:00' });
    expect(res.status).toBe(409);
    expect(await prisma.scheduleSlot.count({ where: { specialistId: specialist.id } })).toBe(1);
  });

  it('permite rangos contiguos (el fin de uno es el inicio del otro)', async () => {
    const { specUser, specialist } = await specialistCtx();
    await postSlot(specialist.id, tokenFor(specUser), { startTime: '09:00', endTime: '11:00' });

    const res = await postSlot(specialist.id, tokenFor(specUser), { startTime: '11:00', endTime: '13:00' });
    expect(res.status).toBe(200);
  });

  it('permite el mismo rango en fechas distintas', async () => {
    const { specUser, specialist } = await specialistCtx();
    await postSlot(specialist.id, tokenFor(specUser), { startTime: '09:00', endTime: '11:00', specificDate: isoDaysFromNow(7) });

    const res = await postSlot(specialist.id, tokenFor(specUser), { startTime: '09:00', endTime: '11:00', specificDate: isoDaysFromNow(14) });
    expect(res.status).toBe(200);
  });

  it('un horario recurrente choca con uno de fecha concreta del mismo día', async () => {
    const { specUser, specialist } = await specialistCtx();
    const date = isoDaysFromNow(7);
    const dow = new Date(`${date}T12:00:00`).getDay();

    await postSlot(specialist.id, tokenFor(specUser), { startTime: '09:00', endTime: '11:00', specificDate: date });

    // Recurrente (sin fecha) en ese mismo día de la semana: aplica a todas las semanas
    const res = await postSlot(specialist.id, tokenFor(specUser), {
      startTime: '10:00', endTime: '12:00', specificDate: null, dayOfWeek: dow,
    });
    expect(res.status).toBe(409);
  });
});

describe('validación de los datos del horario', () => {
  it('rechaza un rango invertido', async () => {
    const { specUser, specialist } = await specialistCtx();
    const res = await postSlot(specialist.id, tokenFor(specUser), { startTime: '13:00', endTime: '09:00' });
    expect(res.status).toBe(400);
  });

  it('rechaza una hora con formato inválido', async () => {
    const { specUser, specialist } = await specialistCtx();
    const res = await postSlot(specialist.id, tokenFor(specUser), { startTime: '25:00', endTime: '26:00' });
    expect(res.status).toBe(400);
  });

  it('rechaza publicar en una fecha pasada', async () => {
    const { specUser, specialist } = await specialistCtx();
    const res = await postSlot(specialist.id, tokenFor(specUser), {
      startTime: '09:00', endTime: '10:00', specificDate: isoDaysFromNow(-3),
    });
    expect(res.status).toBe(422);
  });

  it('deriva el día de la semana de la fecha, ignorando el que mande el cliente', async () => {
    const { specUser, specialist } = await specialistCtx();
    const date = isoDaysFromNow(7);
    const realDow = new Date(`${date}T12:00:00`).getDay();
    const mentira = (realDow + 3) % 7;

    const res = await postSlot(specialist.id, tokenFor(specUser), {
      startTime: '09:00', endTime: '10:00', specificDate: date, dayOfWeek: mentira,
    });

    expect(res.status).toBe(200);
    expect(res.body.dayOfWeek).toBe(realDow);
  });

  it('un especialista no puede publicar en la agenda de otro', async () => {
    const { org, specialist } = await specialistCtx();
    const { user: intrusoUser } = await createSpecialist({ organizationId: org.id });

    const res = await postSlot(specialist.id, tokenFor(intrusoUser), { startTime: '09:00', endTime: '10:00' });
    expect(res.status).toBe(403);
  });
});

describe('saneamiento de URLs en contenido', () => {
  it('rechaza un recurso con esquema javascript:', async () => {
    const { admin } = await specialistCtx();
    const res = await api('POST', '/api/resources', {
      token: tokenFor(admin),
      body: { title: 'r', department: 'Psicología', type: 'link', url: 'javascript:alert(1)' },
    });
    expect(res.status).toBe(400);
  });

  it('rechaza un recurso con esquema data:', async () => {
    const { admin } = await specialistCtx();
    const res = await api('POST', '/api/resources', {
      token: tokenFor(admin),
      body: { title: 'r', department: 'Psicología', type: 'link', url: 'data:text/html,<script>alert(1)</script>' },
    });
    expect(res.status).toBe(400);
  });

  it('acepta http y https', async () => {
    const { admin } = await specialistCtx();
    for (const url of ['http://ejemplo.com/a', 'https://ejemplo.com/b']) {
      const res = await api('POST', '/api/resources', {
        token: tokenFor(admin),
        body: { title: 'r', department: 'Psicología', type: 'link', url },
      });
      expect(res.status).toBe(201);
      expect(res.body.url).toBe(url);
    }
  });

  it('trata la cadena vacía como "sin enlace" en lugar de rechazarla', async () => {
    const { admin } = await specialistCtx();
    const res = await api('POST', '/api/resources', {
      token: tokenFor(admin),
      body: { title: 'r', department: 'Psicología', type: 'articulo', url: '' },
    });
    expect(res.status).toBe(201);
    expect(res.body.url).toBe('#');
  });

  it('rechaza un evento con registrationUrl peligroso', async () => {
    const { admin } = await specialistCtx();
    const res = await api('POST', '/api/events', {
      token: tokenFor(admin),
      body: {
        title: 'e', department: 'Psicología', date: isoDaysFromNow(10),
        type: 'taller', registrationUrl: 'javascript:alert(1)',
      },
    });
    expect(res.status).toBe(400);
  });
});
