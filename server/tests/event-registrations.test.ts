import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, isoDaysFromNow } from './helpers/factories';

/**
 * Quién puede consultar la lista de inscritos a un evento.
 *
 * La conferencia es del DEPARTAMENTO, no de la persona que la dio de alta:
 * quien la imparte o la cubre no siempre es quien la publicó, y antes se quedaba
 * sin poder ver a quién esperar. Por eso el criterio es el departamento, con dos
 * salvaguardas: el autor conserva acceso a lo suyo (los eventos "General" no
 * pertenecen a ningún departamento) y la organización sigue siendo la frontera.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function createEvent(opts: {
  organizationId: string;
  department: string;
  createdById?: string | null;
}) {
  return prisma.appEvent.create({
    data: {
      title: 'Conferencia de prueba',
      description: 'Descripción de prueba',
      department: opts.department,
      date: isoDaysFromNow(10),
      time: '11:00',
      type: 'conferencia',
      createdById: opts.createdById ?? null,
      organizationId: opts.organizationId,
    },
  });
}

/** Un evento de Psicología con una persona ya inscrita. */
async function scenario() {
  const org = await createOrg();
  const { user: autorUser, specialist: autor } =
    await createSpecialist({ organizationId: org.id, department: 'Psicología' });
  const event = await createEvent({
    organizationId: org.id,
    department: 'Psicología',
    createdById: autorUser.id,
  });

  const inscrito = await createUser({ organizationId: org.id });
  await prisma.eventRegistration.create({
    data: { eventId: event.id, userId: inscrito.id, organizationId: org.id },
  });

  return { org, autorUser, autor, event, inscrito };
}

describe('lista de inscritos a un evento', () => {
  it('el especialista del mismo departamento la ve aunque no haya publicado el evento', async () => {
    const { org, event, inscrito } = await scenario();
    const { user: colega } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });

    const res = await api('GET', `/api/events/${event.id}/registrations`, { token: tokenFor(colega) });

    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.userId)).toEqual([inscrito.id]);
  });

  it('el especialista de otro departamento no la ve', async () => {
    const { org, event } = await scenario();
    const { user: ajeno } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });

    const res = await api('GET', `/api/events/${event.id}/registrations`, { token: tokenFor(ajeno) });

    expect(res.status).toBe(403);
  });

  it('el autor conserva acceso a su evento aunque no sea de su departamento', async () => {
    const org = await createOrg();
    const { user: autorUser } = await createSpecialist({ organizationId: org.id, department: 'Tutorías' });
    // "General" no pertenece a ningún departamento: sin la salvaguarda de autoría
    // quien lo publicó se quedaría fuera de su propia lista.
    const event = await createEvent({
      organizationId: org.id,
      department: 'General',
      createdById: autorUser.id,
    });

    const res = await api('GET', `/api/events/${event.id}/registrations`, { token: tokenFor(autorUser) });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('el admin de la organización la ve', async () => {
    const { org, event, inscrito } = await scenario();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('GET', `/api/events/${event.id}/registrations`, { token: tokenFor(admin) });

    expect(res.status).toBe(200);
    expect(res.body.map((r: any) => r.userId)).toEqual([inscrito.id]);
  });

  it('un especialista del mismo departamento en OTRA organización no la ve', async () => {
    const { event } = await scenario();
    const otraOrg = await createOrg();
    const { user: intruso } = await createSpecialist({ organizationId: otraOrg.id, department: 'Psicología' });

    const res = await api('GET', `/api/events/${event.id}/registrations`, { token: tokenFor(intruso) });

    // 404 y no 403: fuera del alcance de su organización el evento ni siquiera existe.
    expect(res.status).toBe(404);
  });

  it('el usuario final no puede consultarla', async () => {
    const { org, event } = await scenario();
    const alumno = await createUser({ organizationId: org.id });

    const res = await api('GET', `/api/events/${event.id}/registrations`, { token: tokenFor(alumno) });

    expect(res.status).toBe(403);
  });
});
