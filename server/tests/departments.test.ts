import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor, waitFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow, setContractedDepartments } from './helpers/factories';

/**
 * Departamentos contratados por organización.
 *
 * El catálogo es fijo a nivel de plataforma; lo que varía es cuáles tiene
 * contratados cada organización. Al retirar uno, la regla acordada es:
 * las citas ya agendadas SE RESPETAN y solo se bloquean las nuevas.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** Organización que solo contrató Psicología. */
async function orgWithoutNutrition() {
  const org = await createOrg();
  await setContractedDepartments(org.id, ['Psicología', 'Tutorías']);
  return org;
}

describe('valor por defecto', () => {
  it('una organización nueva arranca con los tres departamentos', async () => {
    const org = await createOrg();
    const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fresh!.departments).toEqual(['Psicología', 'Tutorías', 'Nutrición']);
  });
});

describe('un departamento no contratado no admite operaciones nuevas', () => {
  it('el usuario no ve a sus especialistas en la lista', async () => {
    const org = await orgWithoutNutrition();
    const student = await createUser({ organizationId: org.id });
    const { specialist: psico } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const { specialist: nutri } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });

    const res = await api('GET', '/api/specialists', { token: tokenFor(student) });
    const ids = res.body.map((s: any) => s.id);

    expect(ids).toContain(psico.id);
    expect(ids).not.toContain(nutri.id);
  });

  it('pedir el departamento explícitamente tampoco lo revela', async () => {
    const org = await orgWithoutNutrition();
    const student = await createUser({ organizationId: org.id });
    await createSpecialist({ organizationId: org.id, department: 'Nutrición' });

    const res = await api('GET', '/api/specialists?department=Nutrición', { token: tokenFor(student) });
    expect(res.body).toEqual([]);
  });

  it('el admin sí los sigue viendo, para poder gestionarlos', async () => {
    const org = await orgWithoutNutrition();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const { specialist: nutri } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });

    const res = await api('GET', '/api/specialists', { token: tokenFor(admin) });
    expect(res.body.map((s: any) => s.id)).toContain(nutri.id);
  });

  it('no ofrece horarios disponibles', async () => {
    const org = await orgWithoutNutrition();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const date = isoDaysFromNow(7);
    await prisma.scheduleSlot.create({
      data: {
        specialistId: specialist.id,
        dayOfWeek: new Date(`${date}T12:00:00`).getDay(),
        startTime: '09:00', endTime: '10:00', specificDate: date,
      },
    });

    const res = await api('GET', `/api/specialists/${specialist.id}/available-slots?date=${date}`, {
      token: tokenFor(student),
    });
    expect(res.body).toEqual([]);
  });

  it('rechaza agendar aunque se llame directo a la API', async () => {
    const org = await orgWithoutNutrition();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(student),
      body: { specialistId: specialist.id, date: isoDaysFromNow(3), time: '10:00', modality: 'Virtual', motivo: 'x' },
    });
    expect(res.status).toBe(409);
  });

  it('rechaza crear un especialista en ese departamento', async () => {
    const org = await orgWithoutNutrition();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('POST', '/api/specialists', {
      token: tokenFor(admin),
      body: { name: 'Nuevo', email: 'nuevo@test.local', department: 'Nutrición' },
    });
    expect(res.status).toBe(409);
  });

  it('permite crear especialistas en los que sí están contratados', async () => {
    const org = await orgWithoutNutrition();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('POST', '/api/specialists', {
      token: tokenFor(admin),
      body: { name: 'Nuevo', email: 'nuevo2@test.local', department: 'Psicología' },
    });
    expect(res.status).toBe(201);
  });
});

describe('las citas ya agendadas se respetan', () => {
  it('al retirar un departamento no se cancela ninguna cita', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const pendiente = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente', time: '09:00' });
    const confirmada = await createAppointment({ student, specialist, organizationId: org.id, status: 'Confirmada', time: '10:00' });

    await setContractedDepartments(org.id, ['Psicología', 'Tutorías']);

    const [p, c] = await Promise.all([
      prisma.appointment.findUnique({ where: { id: pendiente.id } }),
      prisma.appointment.findUnique({ where: { id: confirmada.id } }),
    ]);
    expect(p!.status).toBe('Pendiente');
    expect(c!.status).toBe('Confirmada');
  });

  it('el usuario sigue viendo su cita y su historial', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Confirmada' });
    const pasada = await createAppointment({ student, specialist, organizationId: org.id, status: 'Completada', time: '08:00' });

    await setContractedDepartments(org.id, ['Psicología']);

    const res = await api('GET', '/api/appointments', { token: tokenFor(student) });
    const ids = res.body.map((a: any) => a.id);
    expect(ids).toContain(appt.id);
    expect(ids).toContain(pasada.id);
  });

  it('el especialista conserva su acceso y puede cerrar sus citas', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Confirmada' });

    await setContractedDepartments(org.id, ['Psicología']);

    expect((await api('GET', '/api/auth/me', { token: tokenFor(specUser) })).status).toBe(200);

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada', notes: 'Sesión concluida.' },
    });
    expect(res.status).toBe(200);
  });
});

describe('gestión desde el panel de superadmin', () => {
  /** El superadmin usa su propio token y endpoint. */
  async function superadminToken() {
    const sa = await createUser({ organizationId: null, role: UserRole.superadmin });
    return tokenFor(sa);
  }

  it('guarda los departamentos contratados', async () => {
    const org = await createOrg();
    const token = await superadminToken();

    const res = await api('PATCH', `/api/superadmin/organizations/${org.id}`, {
      token,
      body: { departments: ['Psicología'] },
    });

    expect(res.status).toBe(200);
    const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fresh!.departments).toEqual(['Psicología']);
  });

  it('rechaza un departamento fuera del catálogo', async () => {
    const org = await createOrg();
    const token = await superadminToken();

    const res = await api('PATCH', `/api/superadmin/organizations/${org.id}`, {
      token,
      body: { departments: ['Psicología', 'Radiología'] },
    });

    expect(res.status).toBe(400);
    const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fresh!.departments).toHaveLength(3);
  });

  it('elimina duplicados', async () => {
    const org = await createOrg();
    const token = await superadminToken();

    await api('PATCH', `/api/superadmin/organizations/${org.id}`, {
      token,
      body: { departments: ['Psicología', 'Psicología', 'Tutorías'] },
    });

    const fresh = await prisma.organization.findUnique({ where: { id: org.id } });
    expect(fresh!.departments).toEqual(['Psicología', 'Tutorías']);
  });

  it('avisa a quien tiene una cita abierta en el departamento retirado', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    await createAppointment({ student, specialist, organizationId: org.id, status: 'Confirmada' });
    const token = await superadminToken();

    await api('PATCH', `/api/superadmin/organizations/${org.id}`, {
      token,
      body: { departments: ['Psicología', 'Tutorías'] },
    });

    // El aviso es fire-and-forget: se sondea hasta que aparezca, en vez de
    // dormir un tiempo fijo que fallaría bajo carga.
    const delAlumno = await waitFor(
      async () => {
        const n = await prisma.notification.findMany({ where: { userId: student.id } });
        return n.length > 0 ? n : null;
      },
      { label: 'la notificación al alumno' },
    );
    expect(delAlumno[0].message).toContain('Nutrición');
    // El mensaje deja claro que su cita se mantiene
    expect(delAlumno[0].message).toContain('se mantiene');

    const delEspecialista = await waitFor(
      async () => {
        const n = await prisma.notification.findMany({ where: { userId: specUser.id } });
        return n.length > 0 ? n : null;
      },
      { label: 'la notificación al especialista' },
    );
    expect(delEspecialista.length).toBeGreaterThan(0);
  });

  it('no avisa a quien no tiene cita en ese departamento', async () => {
    const org = await createOrg();
    const ajeno = await createUser({ organizationId: org.id });
    // Un afectado real sirve de señal: cuando SU aviso llega, el proceso ya
    // recorrió a todos los destinatarios. Sin esta ancla habría que dormir un
    // tiempo fijo, y "no pasó nada" sería indistinguible de "aún no pasa".
    const afectado = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    await createAppointment({ student: afectado, specialist, organizationId: org.id, status: 'Confirmada' });
    const token = await superadminToken();

    await api('PATCH', `/api/superadmin/organizations/${org.id}`, {
      token,
      body: { departments: ['Psicología'] },
    });

    await waitFor(
      async () => (await prisma.notification.count({ where: { userId: afectado.id } })) > 0 || null,
      { label: 'el aviso al usuario afectado' },
    );

    expect(await prisma.notification.count({ where: { userId: ajeno.id } })).toBe(0);
  });

  it('volver a contratarlo lo reactiva sin efectos secundarios', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const token = await superadminToken();

    await api('PATCH', `/api/superadmin/organizations/${org.id}`, { token, body: { departments: ['Psicología'] } });
    await api('PATCH', `/api/superadmin/organizations/${org.id}`, {
      token, body: { departments: ['Psicología', 'Tutorías', 'Nutrición'] },
    });

    const res = await api('GET', '/api/specialists', { token: tokenFor(student) });
    expect(res.body.map((s: any) => s.id)).toContain(specialist.id);
  });
});
