import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, isoDaysFromNow, TEST_PASSWORD } from './helpers/factories';

/**
 * Estados que la interfaz muestra y que deben surtir efecto de verdad:
 * el especialista "inactivo" y la organización suspendida.
 *
 * Ambos existían como campo y como etiqueta en pantalla sin filtrar nada, de
 * modo que desactivar a alguien no cambiaba absolutamente nada.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

describe('especialista inactivo', () => {
  it('desaparece de la lista que ve el usuario final', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, active: false });

    const res = await api('GET', '/api/specialists', { token: tokenFor(student) });

    expect(res.status).toBe(200);
    expect(res.body.map((s: any) => s.id)).not.toContain(specialist.id);
  });

  it('sigue siendo visible para el admin, que necesita poder reactivarlo', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const { specialist } = await createSpecialist({ organizationId: org.id, active: false });

    const res = await api('GET', '/api/specialists', { token: tokenFor(admin) });
    expect(res.body.map((s: any) => s.id)).toContain(specialist.id);
  });

  it('sigue siendo visible para sí mismo, porque su panel depende de esa lista', async () => {
    const org = await createOrg();
    const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id, active: false });

    const res = await api('GET', '/api/specialists', { token: tokenFor(specUser) });
    expect(res.body.map((s: any) => s.id)).toContain(specialist.id);
  });

  it('no ofrece horarios disponibles aunque los tenga publicados', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, active: false });
    const date = isoDaysFromNow(7);
    await prisma.scheduleSlot.create({
      data: { specialistId: specialist.id, dayOfWeek: new Date(`${date}T12:00:00`).getDay(), startTime: '09:00', endTime: '10:00', specificDate: date },
    });

    const res = await api('GET', `/api/specialists/${specialist.id}/available-slots?date=${date}`, {
      token: tokenFor(student),
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('rechaza la reserva aunque se llame directo a la API', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id, active: false });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(student),
      body: { specialistId: specialist.id, date: isoDaysFromNow(3), time: '10:00', modality: 'Virtual', motivo: 'x' },
    });
    expect(res.status).toBe(409);
  });

  it('conserva las citas que ya tenía', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id, active: true });
    const appt = await prisma.appointment.create({
      data: {
        studentId: student.id, studentName: student.name,
        specialistId: specialist.id, specialistName: specialist.name,
        department: specialist.department, date: isoDaysFromNow(5), time: '10:00',
        status: 'Confirmada', modality: 'Virtual', motivo: 'x', organizationId: org.id,
      },
    });

    await prisma.specialist.update({ where: { id: specialist.id }, data: { active: false } });

    // Inactivo no es baja: conserva el acceso y puede cerrar lo que ya tenía
    // (con su nota, que en un departamento clínico es obligatoria para cerrar)
    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada', notes: 'Sesión concluida.' },
    });
    expect(res.status).toBe(200);
  });
});

describe('organización suspendida', () => {
  it('bloquea el inicio de sesión de sus usuarios', async () => {
    const org = await createOrg({ active: false });
    const student = await createUser({ organizationId: org.id });

    const res = await api('POST', '/api/auth/login', {
      body: { email: student.email, password: TEST_PASSWORD },
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORGANIZATION_SUSPENDED');
  });

  it('corta las sesiones que ya estaban abiertas', async () => {
    const org = await createOrg({ active: true });
    const student = await createUser({ organizationId: org.id });
    const token = tokenFor(student);

    expect((await api('GET', '/api/auth/me', { token })).status).toBe(200);

    await prisma.organization.update({ where: { id: org.id }, data: { active: false } });

    const after = await api('GET', '/api/auth/me', { token });
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('ORGANIZATION_SUSPENDED');
  });

  it('no afecta a otras organizaciones', async () => {
    const suspendida = await createOrg({ active: false });
    const activa = await createOrg({ active: true });
    await createUser({ organizationId: suspendida.id });
    const ok = await createUser({ organizationId: activa.id });

    const res = await api('GET', '/api/auth/me', { token: tokenFor(ok) });
    expect(res.status).toBe(200);
  });

  it('el superadmin queda exento: es quien debe poder reactivarla', async () => {
    const org = await createOrg({ active: false });
    const superadmin = await createUser({ organizationId: null, role: UserRole.superadmin });

    const res = await api('GET', '/api/auth/me', { token: tokenFor(superadmin) });
    expect(res.status).toBe(200);
    expect(org.active).toBe(false);
  });
});

describe('cuenta dada de baja', () => {
  it('no puede iniciar sesión, con un mensaje que lo explica', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id, deletedAt: new Date() });

    const res = await api('POST', '/api/auth/login', {
      body: { email: student.email, password: TEST_PASSWORD },
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('no recibe correo de recuperación de contraseña', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id, deletedAt: new Date() });

    const res = await api('POST', '/api/auth/forgot-password', { body: { email: student.email } });

    // Responde 200 genérico para no revelar qué correos existen…
    expect(res.status).toBe(200);
    // …pero no genera token de restablecimiento
    const after = await prisma.user.findUnique({ where: { id: student.id } });
    expect(after!.resetPasswordToken).toBeNull();
  });

  it('desaparece del listado de usuarios del admin', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const baja = await createUser({ organizationId: org.id, deletedAt: new Date() });
    const activo = await createUser({ organizationId: org.id });

    const res = await api('GET', '/api/users', { token: tokenFor(admin) });
    const ids = res.body.map((u: any) => u.id);

    expect(ids).toContain(activo.id);
    expect(ids).not.toContain(baja.id);
  });

  it('el admin puede pedirlos explícitamente para reactivarlos', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const baja = await createUser({ organizationId: org.id, deletedAt: new Date() });

    const res = await api('GET', '/api/users?includeDeleted=1', { token: tokenFor(admin) });
    expect(res.body.map((u: any) => u.id)).toContain(baja.id);
  });
});
