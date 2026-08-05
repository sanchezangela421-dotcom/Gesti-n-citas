import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import {
  createOrg, createUser, createSpecialist, createAppointment, createClinicalNote, isoDaysFromNow,
} from './helpers/factories';
import { UserRole } from '@prisma/client';

/**
 * Retención del expediente clínico (NOM-004).
 *
 * Es la garantía que no puede romperse: conservar el expediente es una
 * obligación legal, así que se verifica en los dos niveles.
 *
 * 1. La base de datos rechaza el borrado aunque alguien lo intente por fuera de
 *    la aplicación (FKs Restrict).
 * 2. La aplicación nunca lo intenta: las bajas son lógicas.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** Escenario mínimo con expediente: paciente + especialista + cita + nota. */
async function scenarioWithRecord() {
  const org = await createOrg();
  const student = await createUser({ organizationId: org.id });
  const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id });
  const appointment = await createAppointment({
    student, specialist, organizationId: org.id, status: 'Completada',
  });
  const note = await createClinicalNote({
    appointmentId: appointment.id,
    specialistId: specialist.id,
    studentId: student.id,
    department: specialist.department,
    organizationId: org.id,
  });
  return { org, student, specUser, specialist, appointment, note };
}

describe('la base de datos impide borrar un expediente', () => {
  it('rechaza borrar al paciente', async () => {
    const { student } = await scenarioWithRecord();
    await expect(prisma.user.delete({ where: { id: student.id } })).rejects.toThrow();
  });

  it('rechaza borrar al especialista que firmó la nota', async () => {
    const { specialist } = await scenarioWithRecord();
    await expect(prisma.specialist.delete({ where: { id: specialist.id } })).rejects.toThrow();
  });

  it('rechaza borrar la cuenta del especialista (la cascada a Specialist queda bloqueada)', async () => {
    const { specUser } = await scenarioWithRecord();
    await expect(prisma.user.delete({ where: { id: specUser.id } })).rejects.toThrow();
  });

  it('rechaza borrar la cita que sostiene la nota', async () => {
    const { appointment } = await scenarioWithRecord();
    await expect(prisma.appointment.delete({ where: { id: appointment.id } })).rejects.toThrow();
  });

  it('tras cada intento fallido la nota sigue intacta', async () => {
    const { student, specialist, appointment, note } = await scenarioWithRecord();

    await prisma.user.delete({ where: { id: student.id } }).catch(() => null);
    await prisma.specialist.delete({ where: { id: specialist.id } }).catch(() => null);
    await prisma.appointment.delete({ where: { id: appointment.id } }).catch(() => null);

    const survivor = await prisma.clinicalNote.findUnique({ where: { id: note.id } });
    expect(survivor).not.toBeNull();
    expect(survivor!.body).toBe(note.body);
  });
});

describe('la baja de un especialista conserva el historial', () => {
  it('marca deletedAt en vez de borrar, y el expediente sobrevive', async () => {
    const { org, specialist, note } = await scenarioWithRecord();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('DELETE', `/api/specialists/${specialist.id}`, {
      token: tokenFor(admin),
      body: { reason: 'Cambio de adscripción' },
    });

    expect(res.status).toBe(200);
    const after = await prisma.specialist.findUnique({ where: { id: specialist.id } });
    expect(after).not.toBeNull();
    expect(after!.deletedAt).not.toBeNull();
    expect(after!.active).toBe(false);
    expect(await prisma.clinicalNote.findUnique({ where: { id: note.id } })).not.toBeNull();
  });

  it('cancela sus citas abiertas con el motivo, sin tocar las cerradas', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id });
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const pendiente = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente', time: '09:00' });
    const confirmada = await createAppointment({ student, specialist, organizationId: org.id, status: 'Confirmada', time: '10:00' });
    const completada = await createAppointment({ student, specialist, organizationId: org.id, status: 'Completada', time: '11:00' });

    const res = await api('DELETE', `/api/specialists/${specialist.id}`, {
      token: tokenFor(admin),
      body: { reason: 'Baja médica' },
    });

    expect(res.status).toBe(200);
    expect(res.body.cancelledAppointments).toBe(2);

    const [p, c, done] = await Promise.all([
      prisma.appointment.findUnique({ where: { id: pendiente.id } }),
      prisma.appointment.findUnique({ where: { id: confirmada.id } }),
      prisma.appointment.findUnique({ where: { id: completada.id } }),
    ]);

    expect(p!.status).toBe('Cancelada');
    expect(p!.cancellationReason).toBe('Baja médica');
    expect(c!.status).toBe('Cancelada');
    // La cita completada es historial clínico: no se toca jamás
    expect(done!.status).toBe('Completada');
    expect(done!.cancellationReason).toBeNull();
  });

  it('corta la sesión que el especialista tuviera abierta', async () => {
    const org = await createOrg();
    const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id });
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const specToken = tokenFor(specUser);

    expect((await api('GET', '/api/auth/me', { token: specToken })).status).toBe(200);

    await api('DELETE', `/api/specialists/${specialist.id}`, { token: tokenFor(admin) });

    const after = await api('GET', '/api/auth/me', { token: specToken });
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('ACCOUNT_DEACTIVATED');
  });

  it('retira sus horarios para que nadie pueda reservar', async () => {
    const org = await createOrg();
    const { specialist } = await createSpecialist({ organizationId: org.id });
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    await prisma.scheduleSlot.create({
      data: { specialistId: specialist.id, dayOfWeek: 1, startTime: '09:00', endTime: '10:00', specificDate: isoDaysFromNow(7) },
    });

    await api('DELETE', `/api/specialists/${specialist.id}`, { token: tokenFor(admin) });

    expect(await prisma.scheduleSlot.count({ where: { specialistId: specialist.id } })).toBe(0);
  });

  it('se puede reactivar', async () => {
    const org = await createOrg();
    const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id });
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    await api('DELETE', `/api/specialists/${specialist.id}`, { token: tokenFor(admin) });
    const res = await api('POST', `/api/specialists/${specialist.id}/restore`, { token: tokenFor(admin) });

    expect(res.status).toBe(200);
    const after = await prisma.specialist.findUnique({ where: { id: specialist.id } });
    expect(after!.deletedAt).toBeNull();
    expect(after!.active).toBe(true);
    const account = await prisma.user.findUnique({ where: { id: specUser.id } });
    expect(account!.deletedAt).toBeNull();
  });
});

describe('la baja de un paciente conserva su expediente', () => {
  it('marca deletedAt y la nota clínica sobrevive', async () => {
    const { org, student, note } = await scenarioWithRecord();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('DELETE', `/api/users/${student.id}`, { token: tokenFor(admin) });

    expect(res.status).toBe(200);
    const after = await prisma.user.findUnique({ where: { id: student.id } });
    expect(after).not.toBeNull();
    expect(after!.deletedAt).not.toBeNull();
    expect(await prisma.clinicalNote.findUnique({ where: { id: note.id } })).not.toBeNull();
  });

  it('sigue apareciendo en el expediente del especialista, marcado como inactivo', async () => {
    const { org, student, specUser, specialist } = await scenarioWithRecord();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    await api('DELETE', `/api/users/${student.id}`, { token: tokenFor(admin) });

    const patients = await api('GET', '/api/patients', { token: tokenFor(specUser) });
    expect(patients.status).toBe(200);
    const found = patients.body.find((p: any) => p.studentId === student.id);
    expect(found).toBeDefined();
    expect(found.inactive).toBe(true);

    const record = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(specUser) });
    expect(record.status).toBe(200);
    expect(record.body.inactive).toBe(true);
    expect(record.body.timeline.length).toBeGreaterThan(0);
    expect(record.body.timeline[0].note).not.toBeNull();
    // El especialista sigue estando activo; el inactivo es el paciente
    expect(specialist.deletedAt).toBeNull();
  });

  it('no permite agendarle citas nuevas', async () => {
    const org = await createOrg();
    const student = await createUser({ organizationId: org.id });
    const { specialist } = await createSpecialist({ organizationId: org.id });
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    await api('DELETE', `/api/users/${student.id}`, { token: tokenFor(admin) });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(admin),
      body: {
        studentId: student.id, specialistId: specialist.id,
        date: isoDaysFromNow(3), time: '10:00', modality: 'Virtual', motivo: 'x',
      },
    });
    expect(res.status).toBe(404);
  });

  it('redirige la baja de un especialista a su propia ruta', async () => {
    const org = await createOrg();
    const { user: specUser } = await createSpecialist({ organizationId: org.id });
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('DELETE', `/api/users/${specUser.id}`, { token: tokenFor(admin) });
    expect(res.status).toBe(409);
  });
});
