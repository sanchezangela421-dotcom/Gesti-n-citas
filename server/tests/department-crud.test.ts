import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment } from './helpers/factories';

/**
 * Gestión del catálogo de departamentos desde el panel de superadmin.
 *
 * Solo el superadmin los crea, renombra y retira. La regla que sostiene todo:
 * el nombre viaja denormalizado al expediente, así que en cuanto un
 * departamento tiene citas o especialistas queda sellado — se desactiva, pero
 * no se renombra ni se borra.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** El superadmin usa su propio token. */
async function superadminToken() {
  const sa = await createUser({ role: UserRole.superadmin, organizationId: null });
  return tokenFor(sa);
}

describe('alta de un departamento propio', () => {
  it('el superadmin puede crear uno con su color, icono y régimen de nota', async () => {
    const org = await createOrg();
    const token = await superadminToken();

    const res = await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token,
      body: { name: 'Trabajo Social', color: '#7c3aed', icon: 'HeartHandshake', requiresNote: true },
    });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Trabajo Social');
    expect(res.body.requiresNote).toBe(true);
    expect(res.body.active).toBe(true);
  });

  it('queda contratado de inmediato y el usuario lo ve', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Trabajo Social' },
    });

    // La columna derivada se sincroniza: es lo que lee el frontend en /auth/me
    const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fresh!.departments).toContain('Trabajo Social');
  });

  it('se puede agendar en un departamento propio', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Trabajo Social' },
    });

    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Trabajo Social' });
    const alumno = await createUser({ organizationId: org.id });

    const res = await api('GET', '/api/specialists', { token: tokenFor(alumno) });

    expect(res.status).toBe(200);
    expect(res.body.map((s: { id: string }) => s.id)).toContain(specialist.id);
  });

  it('rechaza un nombre repetido y uno demasiado corto', async () => {
    const org = await createOrg();
    const token = await superadminToken();

    const repetido = await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Psicología' },
    });
    expect(repetido.status).toBe(409);

    const corto = await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'X' },
    });
    expect(corto.status).toBe(400);
  });

  it('no se filtra a otra organización', async () => {
    const a = await createOrg();
    const b = await createOrg();
    const token = await superadminToken();
    await api('POST', `/api/superadmin/organizations/${a.id}/departments`, {
      token, body: { name: 'Trabajo Social' },
    });

    const res = await api('GET', `/api/superadmin/organizations/${b.id}/departments`, { token });
    expect(res.body.map((d: { name: string }) => d.name)).not.toContain('Trabajo Social');
  });
});

describe('renombrar', () => {
  it('se permite mientras no tenga citas ni especialistas', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const creado = await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Trabajo Socail' }, // con la errata
    });

    const res = await api('PATCH', `/api/superadmin/organizations/${org.id}/departments/${creado.body.id}`, {
      token, body: { name: 'Trabajo Social' },
    });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Trabajo Social');
  });

  it('se BLOQUEA en cuanto tiene un especialista', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const dept = await prisma.orgDepartment.findFirst({
      where: { organizationId: org.id, name: 'Psicología' },
    });
    await createSpecialist({ organizationId: org.id, department: 'Psicología' });

    const res = await api('PATCH', `/api/superadmin/organizations/${org.id}/departments/${dept!.id}`, {
      token, body: { name: 'Psicología Clínica' },
    });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEPARTMENT_IN_USE');
  });

  it('se BLOQUEA en cuanto tiene citas: el expediente las referencia por nombre', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const alumno = await createUser({ organizationId: org.id });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const dept = await prisma.orgDepartment.findFirst({
      where: { organizationId: org.id, name: 'Nutrición' },
    });

    const res = await api('PATCH', `/api/superadmin/organizations/${org.id}/departments/${dept!.id}`, {
      token, body: { name: 'Nutrición y Dietética' },
    });

    expect(res.status).toBe(409);
    // El nombre en las citas sigue intacto.
    const appts = await prisma.appointment.findMany({ where: { organizationId: org.id } });
    expect(appts.every(a => a.department === 'Nutrición')).toBe(true);
  });

  it('cambiar solo el color o el icono SÍ se permite aunque tenga citas', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const alumno = await createUser({ organizationId: org.id });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const dept = await prisma.orgDepartment.findFirst({
      where: { organizationId: org.id, name: 'Psicología' },
    });

    const res = await api('PATCH', `/api/superadmin/organizations/${org.id}/departments/${dept!.id}`, {
      token, body: { color: '#111827' },
    });

    expect(res.status).toBe(200);
    expect(res.body.color).toBe('#111827');
    expect(res.body.name).toBe('Psicología');
  });
});

describe('retirar y eliminar', () => {
  it('desactivarlo lo saca del catálogo contratado sin tocar las citas', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const alumno = await createUser({ organizationId: org.id });
    const appt = await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const dept = await prisma.orgDepartment.findFirst({
      where: { organizationId: org.id, name: 'Nutrición' },
    });
    const res = await api('PATCH', `/api/superadmin/organizations/${org.id}/departments/${dept!.id}`, {
      token, body: { active: false },
    });

    expect(res.status).toBe(200);
    const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fresh!.departments).not.toContain('Nutrición');

    // La cita agendada se respeta: retirar nunca canceló nada.
    const sigue = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(sigue!.status).toBe('Confirmada');
  });

  it('eliminar solo se permite si nunca se usó', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const creado = await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Creado por error' },
    });

    const res = await api('DELETE', `/api/superadmin/organizations/${org.id}/departments/${creado.body.id}`, { token });
    expect(res.status).toBe(200);

    const quedan = await prisma.orgDepartment.count({
      where: { organizationId: org.id, name: 'Creado por error' },
    });
    expect(quedan).toBe(0);
  });

  it('con citas detrás, eliminar se rechaza', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const alumno = await createUser({ organizationId: org.id });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const dept = await prisma.orgDepartment.findFirst({
      where: { organizationId: org.id, name: 'Psicología' },
    });

    const res = await api('DELETE', `/api/superadmin/organizations/${org.id}/departments/${dept!.id}`, { token });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DEPARTMENT_IN_USE');
  });
});

describe('régimen de nota por departamento', () => {
  it('un departamento propio marcado como clínico exige nota al cerrar', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Psiquiatría', requiresNote: true },
    });

    const { user: specUser, specialist } = await createSpecialist({
      organizationId: org.id, department: 'Psiquiatría',
    });
    const alumno = await createUser({ organizationId: org.id });
    const appt = await createAppointment({
      student: alumno, specialist, organizationId: org.id, status: 'Confirmada',
    });

    const sinNota = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada' },
    });
    expect(sinNota.status).toBe(400);
    expect(sinNota.body.code).toBe('NOTE_REQUIRED');

    const conNota = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada', notes: 'Valoración inicial.' },
    });
    expect(conNota.status).toBe(200);
  });

  it('uno propio NO clínico cierra sin nota', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Orientación Vocacional', requiresNote: false },
    });

    const { user: specUser, specialist } = await createSpecialist({
      organizationId: org.id, department: 'Orientación Vocacional',
    });
    const alumno = await createUser({ organizationId: org.id });
    const appt = await createAppointment({
      student: alumno, specialist, organizationId: org.id, status: 'Confirmada',
    });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada' },
    });

    expect(res.status).toBe(200);
  });
});

describe('el catálogo llega al cliente', () => {
  it('/auth/me devuelve los departamentos con color, icono y régimen de nota', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    await api('POST', `/api/superadmin/organizations/${org.id}/departments`, {
      token, body: { name: 'Trabajo Social', color: '#7c3aed', icon: 'HeartHandshake', requiresNote: true },
    });
    const alumno = await createUser({ organizationId: org.id });

    const res = await api('GET', '/api/auth/me', { token: tokenFor(alumno) });

    expect(res.status).toBe(200);
    const propio = res.body.organization.orgDepartments.find(
      (d: { name: string }) => d.name === 'Trabajo Social',
    );
    expect(propio).toBeTruthy();
    expect(propio.color).toBe('#7c3aed');
    expect(propio.icon).toBe('HeartHandshake');
    expect(propio.requiresNote).toBe(true);
  });

  it('no incluye los departamentos retirados', async () => {
    const org = await createOrg();
    const token = await superadminToken();
    const dept = await prisma.orgDepartment.findFirst({
      where: { organizationId: org.id, name: 'Tutorías' },
    });
    await api('PATCH', `/api/superadmin/organizations/${org.id}/departments/${dept!.id}`, {
      token, body: { active: false },
    });
    const alumno = await createUser({ organizationId: org.id });

    const res = await api('GET', '/api/auth/me', { token: tokenFor(alumno) });

    const nombres = res.body.organization.orgDepartments.map((d: { name: string }) => d.name);
    expect(nombres).not.toContain('Tutorías');
    expect(nombres).toContain('Psicología');
  });
});
