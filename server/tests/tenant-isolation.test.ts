import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow } from './helpers/factories';

/**
 * Aislamiento multi-tenant.
 *
 * La plataforma aloja organizaciones distintas (escuelas, hospitales, empresas)
 * sobre la misma base. Que los datos de una nunca se filtren a otra es la
 * premisa del producto, y basta un `where` sin `orgScope` para romperla, así que
 * se comprueba endpoint por endpoint y no solo en el helper.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** Dos organizaciones completas y ajenas entre sí. */
async function twoOrgs() {
  const orgA = await createOrg({ name: 'Org A' });
  const orgB = await createOrg({ name: 'Org B' });

  const adminA = await createUser({ organizationId: orgA.id, role: UserRole.admin });
  const adminB = await createUser({ organizationId: orgB.id, role: UserRole.admin });
  const studentA = await createUser({ organizationId: orgA.id, name: 'Alumno A' });
  const studentB = await createUser({ organizationId: orgB.id, name: 'Alumno B' });
  const { specialist: specA } = await createSpecialist({ organizationId: orgA.id, name: 'Esp A' });
  const { specialist: specB } = await createSpecialist({ organizationId: orgB.id, name: 'Esp B' });

  const apptA = await createAppointment({ student: studentA, specialist: specA, organizationId: orgA.id });
  const apptB = await createAppointment({ student: studentB, specialist: specB, organizationId: orgB.id });

  return { orgA, orgB, adminA, adminB, studentA, studentB, specA, specB, apptA, apptB };
}

describe('un admin solo ve su propia organización', () => {
  it('no ve las citas de otra organización', async () => {
    const { adminA, apptA, apptB } = await twoOrgs();
    const res = await api('GET', '/api/appointments', { token: tokenFor(adminA) });

    expect(res.status).toBe(200);
    const ids = res.body.map((a: any) => a.id);
    expect(ids).toContain(apptA.id);
    expect(ids).not.toContain(apptB.id);
  });

  it('no ve los usuarios de otra organización', async () => {
    const { adminA, studentA, studentB } = await twoOrgs();
    const res = await api('GET', '/api/users', { token: tokenFor(adminA) });

    const ids = res.body.map((u: any) => u.id);
    expect(ids).toContain(studentA.id);
    expect(ids).not.toContain(studentB.id);
  });

  it('no ve los especialistas de otra organización', async () => {
    const { adminA, specA, specB } = await twoOrgs();
    const res = await api('GET', '/api/specialists', { token: tokenFor(adminA) });

    const ids = res.body.map((s: any) => s.id);
    expect(ids).toContain(specA.id);
    expect(ids).not.toContain(specB.id);
  });
});

describe('conocer un ID ajeno no da acceso (IDOR)', () => {
  it('no puede leer un usuario de otra organización por ID', async () => {
    const { adminA, studentB } = await twoOrgs();
    const res = await api('GET', `/api/users/${studentB.id}`, { token: tokenFor(adminA) });
    expect(res.status).toBe(404);
  });

  it('no puede dar de baja a un usuario de otra organización', async () => {
    const { adminA, studentB } = await twoOrgs();
    const res = await api('DELETE', `/api/users/${studentB.id}`, { token: tokenFor(adminA) });

    expect(res.status).toBe(404);
    const still = await prisma.user.findUnique({ where: { id: studentB.id } });
    expect(still!.deletedAt).toBeNull();
  });

  it('no puede dar de baja a un especialista de otra organización', async () => {
    const { adminA, specB } = await twoOrgs();
    const res = await api('DELETE', `/api/specialists/${specB.id}`, { token: tokenFor(adminA) });

    expect(res.status).toBe(404);
    const still = await prisma.specialist.findUnique({ where: { id: specB.id } });
    expect(still!.deletedAt).toBeNull();
  });

  it('no puede cambiar el estado de una cita de otra organización', async () => {
    const { adminA, apptB } = await twoOrgs();
    const res = await api('PATCH', `/api/appointments/${apptB.id}/status`, {
      token: tokenFor(adminA),
      body: { status: 'Cancelada', notes: 'intento cruzado' },
    });

    expect(res.status).toBe(404);
    const still = await prisma.appointment.findUnique({ where: { id: apptB.id } });
    expect(still!.status).toBe('Confirmada');
  });

  it('no puede reagendar una cita de otra organización', async () => {
    const { adminA, apptB } = await twoOrgs();
    const res = await api('PATCH', `/api/appointments/${apptB.id}/reschedule`, {
      token: tokenFor(adminA),
      body: { date: isoDaysFromNow(10), time: '15:00' },
    });
    expect(res.status).toBe(404);
  });

  it('no puede notificar a un usuario de otra organización', async () => {
    const { adminA, studentB } = await twoOrgs();
    const res = await api('POST', '/api/notifications', {
      token: tokenFor(adminA),
      body: { userId: studentB.id, title: 'x', message: 'y', type: 'info' },
    });

    expect(res.status).toBe(404);
    expect(await prisma.notification.count({ where: { userId: studentB.id } })).toBe(0);
  });
});

describe('no se pueden mezclar organizaciones al agendar', () => {
  it('rechaza una cita entre alumno y especialista de organizaciones distintas', async () => {
    const { adminA, studentA, specB } = await twoOrgs();
    const res = await api('POST', '/api/appointments', {
      token: tokenFor(adminA),
      body: {
        studentId: studentA.id, specialistId: specB.id,
        date: isoDaysFromNow(3), time: '10:00', modality: 'Virtual', motivo: 'x',
      },
    });
    // El especialista ajeno ni siquiera es visible dentro del alcance del admin
    expect(res.status).toBe(404);
  });
});

describe('las estadísticas se limitan a la organización', () => {
  it('no suma las citas de otra organización', async () => {
    const { orgA, adminA, studentA, specA } = await twoOrgs();
    // Una cita extra en A: el total de A debe ser 2, nunca 3 (la de B queda fuera)
    await createAppointment({ student: studentA, specialist: specA, organizationId: orgA.id, time: '12:00' });

    const res = await api('GET', '/api/stats', { token: tokenFor(adminA) });
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(2);
  });
});
