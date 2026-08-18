import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment } from './helpers/factories';

/**
 * Quién puede cerrar una cita y con qué requisito.
 *
 * Completar es un acto CLÍNICO: lo hace quien atendió la sesión y, en los
 * departamentos de salud, deja constancia de lo ocurrido (NOM-004). El admin
 * gestiona la agenda —confirma, cancela, reagenda— pero no puede dar por
 * atendido algo que no presenció.
 *
 * Tutorías queda fuera de la obligación a propósito: es acompañamiento
 * académico, no un servicio de salud.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** Una cita confirmada lista para cerrarse, en el departamento indicado. */
async function confirmedAppointment(department: string) {
  const org = await createOrg();
  const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id, department });
  const student = await createUser({ organizationId: org.id });
  const appt = await createAppointment({
    student, specialist, organizationId: org.id, status: 'Confirmada',
  });
  return { org, specUser, specialist, student, appt };
}

describe('solo el especialista cierra la cita', () => {
  it('el admin no puede marcarla como completada', async () => {
    const { org, appt } = await confirmedAppointment('Psicología');
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(admin), body: { status: 'Completada', notes: 'Cerrada por el admin' },
    });

    expect(res.status).toBe(403);
    const fresh = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(fresh!.status).toBe('Confirmada');
  });

  it('el admin sí puede seguir cancelando', async () => {
    const { org, appt } = await confirmedAppointment('Psicología');
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(admin), body: { status: 'Cancelada', notes: 'El especialista se reportó enfermo.' },
    });

    expect(res.status).toBe(200);
  });

  it('el usuario final tampoco puede cerrarla', async () => {
    const { appt, student } = await confirmedAppointment('Psicología');

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(student), body: { status: 'Completada', notes: 'x' },
    });

    expect(res.status).toBe(403);
  });
});

describe('la nota es obligatoria en departamentos clínicos', () => {
  it('Psicología: sin nota no cierra', async () => {
    const { specUser, appt } = await confirmedAppointment('Psicología');

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada' },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('NOTE_REQUIRED');
    const fresh = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(fresh!.status).toBe('Confirmada');
  });

  it('Psicología: una nota en blanco tampoco vale', async () => {
    const { specUser, appt } = await confirmedAppointment('Psicología');

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada', notes: '    ' },
    });

    expect(res.status).toBe(400);
  });

  it('Nutrición: con nota cierra y la nota queda guardada', async () => {
    const { specUser, specialist, appt } = await confirmedAppointment('Nutrición');

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada', notes: 'Plan alimenticio ajustado.' },
    });

    expect(res.status).toBe(200);
    const note = await prisma.clinicalNote.findUnique({ where: { appointmentId: appt.id } });
    expect(note!.body).toBe('Plan alimenticio ajustado.');
    expect(note!.specialistId).toBe(specialist.id);
  });
});

describe('Tutorías no exige nota', () => {
  it('cierra sin anotación', async () => {
    const { specUser, appt } = await confirmedAppointment('Tutorías');

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada' },
    });

    expect(res.status).toBe(200);
    const fresh = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(fresh!.status).toBe('Completada');
  });

  it('si el tutor escribe observaciones, se guardan igual', async () => {
    const { specUser, appt } = await confirmedAppointment('Tutorías');

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada', notes: 'Se acordó plan de estudio semanal.' },
    });

    expect(res.status).toBe(200);
    const note = await prisma.clinicalNote.findUnique({ where: { appointmentId: appt.id } });
    expect(note!.body).toBe('Se acordó plan de estudio semanal.');
  });
});
