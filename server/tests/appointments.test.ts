import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow } from './helpers/factories';

/**
 * Ciclo de vida de las citas: transiciones de estado, permisos por rol y las
 * reglas de negocio que protegen la agenda (choques de horario, plazos de
 * cancelación, citas en el pasado).
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function scenario() {
  const org = await createOrg();
  const student = await createUser({ organizationId: org.id, name: 'Alumno' });
  const { user: specUser, specialist } = await createSpecialist({ organizationId: org.id });
  const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
  return { org, student, specUser, specialist, admin };
}

describe('transiciones de estado válidas', () => {
  it('Pendiente puede confirmarse', async () => {
    const { org, student, specUser, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Confirmada' },
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Confirmada');
  });

  it('Pendiente NO puede saltar directo a Completada', async () => {
    const { org, student, specUser, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Completada' },
    });
    expect(res.status).toBe(422);
  });

  it('una cita Cancelada es terminal', async () => {
    const { org, student, specUser, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Cancelada' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Confirmada' },
    });
    expect(res.status).toBe(422);
  });

  it('una cita Completada es terminal', async () => {
    const { org, student, specUser, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Completada' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Cancelada', notes: 'motivo' },
    });
    expect(res.status).toBe(422);
  });
});

describe('permisos sobre la cita', () => {
  it('el alumno solo puede cancelar, no confirmar', async () => {
    const { org, student, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(student), body: { status: 'Confirmada' },
    });
    expect(res.status).toBe(403);
  });

  it('un alumno no puede tocar la cita de otro', async () => {
    const { org, student, specialist } = await scenario();
    const otro = await createUser({ organizationId: org.id, name: 'Otro alumno' });
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(otro), body: { status: 'Cancelada' },
    });
    expect(res.status).toBe(403);
  });

  it('un especialista no puede tocar la cita de otro especialista', async () => {
    const { org, student, specialist } = await scenario();
    const { user: otroSpecUser } = await createSpecialist({ organizationId: org.id });
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(otroSpecUser), body: { status: 'Confirmada' },
    });
    expect(res.status).toBe(403);
  });

  it('el especialista debe justificar la cancelación', async () => {
    const { org, student, specUser, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Confirmada' });

    const sinMotivo = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Cancelada' },
    });
    expect(sinMotivo.status).toBe(400);

    const conMotivo = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser), body: { status: 'Cancelada', notes: 'Imprevisto' },
    });
    expect(conMotivo.status).toBe(200);
    expect(conMotivo.body.cancellationReason).toBe('Imprevisto');
  });
});

describe('reglas de agenda', () => {
  it('rechaza agendar en el pasado', async () => {
    const { student, specialist } = await scenario();
    const res = await api('POST', '/api/appointments', {
      token: tokenFor(student),
      body: {
        specialistId: specialist.id, date: isoDaysFromNow(-1),
        time: '10:00', modality: 'Virtual', motivo: 'x',
      },
    });
    expect(res.status).toBe(422);
  });

  it('rechaza una fecha con formato inválido', async () => {
    const { student, specialist } = await scenario();
    const res = await api('POST', '/api/appointments', {
      token: tokenFor(student),
      body: {
        specialistId: specialist.id, date: 'no-es-fecha',
        time: '10:00', modality: 'Virtual', motivo: 'x',
      },
    });
    expect(res.status).toBe(422);
  });

  it('rechaza dos citas en el mismo hueco del mismo especialista', async () => {
    const { org, student, specialist } = await scenario();
    const date = isoDaysFromNow(5);
    await createAppointment({ student, specialist, organizationId: org.id, date, time: '10:00', status: 'Confirmada' });

    const otro = await createUser({ organizationId: org.id });
    const res = await api('POST', '/api/appointments', {
      token: tokenFor(otro),
      body: { specialistId: specialist.id, date, time: '10:00', modality: 'Virtual', motivo: 'x' },
    });
    expect(res.status).toBe(409);
  });

  it('un hueco liberado por cancelación vuelve a estar disponible', async () => {
    const { org, student, specialist } = await scenario();
    const date = isoDaysFromNow(5);
    await createAppointment({ student, specialist, organizationId: org.id, date, time: '10:00', status: 'Cancelada' });

    const otro = await createUser({ organizationId: org.id });
    const res = await api('POST', '/api/appointments', {
      token: tokenFor(otro),
      body: { specialistId: specialist.id, date, time: '10:00', modality: 'Virtual', motivo: 'x' },
    });
    expect(res.status).toBe(201);
  });

  it('el alumno no puede cancelar con menos de 24 h de anticipación', async () => {
    const { org, student, specialist } = await scenario();
    // Hoy, en un horario ya muy próximo
    const appt = await createAppointment({
      student, specialist, organizationId: org.id,
      status: 'Confirmada', date: isoDaysFromNow(0), time: '23:59',
    });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(student), body: { status: 'Cancelada' },
    });
    expect(res.status).toBe(422);
  });

  it('el cliente no puede falsear el nombre ni el departamento', async () => {
    const { student, specialist } = await scenario();
    const res = await api('POST', '/api/appointments', {
      token: tokenFor(student),
      body: {
        specialistId: specialist.id, date: isoDaysFromNow(4), time: '11:00',
        modality: 'Virtual', motivo: 'x',
        // Valores falsificados: el servidor debe derivarlos de la BD
        studentName: 'Nombre Falso', specialistName: 'Otro Nombre', department: 'Departamento Falso',
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.studentName).toBe(student.name);
    expect(res.body.specialistName).toBe(specialist.name);
    expect(res.body.department).toBe(specialist.department);
  });

  it('el alumno no puede agendar a nombre de otra persona', async () => {
    const { org, student, specialist } = await scenario();
    const victima = await createUser({ organizationId: org.id, name: 'Víctima' });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(student),
      body: {
        studentId: victima.id, specialistId: specialist.id,
        date: isoDaysFromNow(4), time: '12:00', modality: 'Virtual', motivo: 'x',
      },
    });

    expect(res.status).toBe(201);
    // El servidor ignora studentId y usa la identidad del token
    expect(res.body.studentId).toBe(student.id);
  });
});

describe('saneamiento del enlace de videollamada', () => {
  it('rechaza un esquema javascript: al confirmar', async () => {
    const { org, student, specUser, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser),
      body: { status: 'Confirmada', meetingUrl: 'javascript:alert(1)' },
    });

    expect(res.status).toBe(400);
    const still = await prisma.appointment.findUnique({ where: { id: appt.id } });
    expect(still!.status).toBe('Pendiente');
  });

  it('acepta https', async () => {
    const { org, student, specUser, specialist } = await scenario();
    const appt = await createAppointment({ student, specialist, organizationId: org.id, status: 'Pendiente' });

    const res = await api('PATCH', `/api/appointments/${appt.id}/status`, {
      token: tokenFor(specUser),
      body: { status: 'Confirmada', meetingUrl: 'https://meet.example.com/abc' },
    });

    expect(res.status).toBe(200);
    expect(res.body.meetingUrl).toBe('https://meet.example.com/abc');
  });
});
