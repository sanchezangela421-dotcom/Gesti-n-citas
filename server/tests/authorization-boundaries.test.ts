import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor, waitFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, isoDaysFromNow } from './helpers/factories';

/**
 * Dos fronteras que estaban abiertas y que el cliente no puede sostener.
 *
 * 1. `/api/stats` agrega citas de TERCEROS: totales de la organización entera,
 *    demografía de quienes asistieron y `charts.motivos`, que es el texto libre
 *    que cada paciente escribió al agendar, separado por departamento. Solo
 *    tenía `verifyToken`, así que cualquier alumno recibía lo mismo que el
 *    administrador. `orgScope` no ayuda aquí: acota a la organización, no al
 *    que llama.
 *
 * 2. `POST /api/appointments` no ataba `specialistId` a quien llamaba. Eso valía
 *    dos cosas. La menor, agendar a nombre de un colega. La grave, emparejarse
 *    con cualquier paciente de la organización: esa fila es exactamente lo que
 *    `patients.ts` acepta como relación de atención, así que era una forma de
 *    autoconcederse acceso al expediente de alguien a quien nunca se atendió.
 *
 * El segundo caso es el que muestra por qué una sola condición no bastaba: atar
 * la cita a la propia agenda cierra la suplantación, pero no el expediente.
 * Hace falta además que la relación de atención ya exista.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

describe('/api/stats solo lo lee quien administra la organización', () => {
  it.each([
    ['alumno', UserRole.alumno],
    ['usuario', UserRole.usuario],
  ])('un %s recibe 403', async (_label, role) => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id, role });

    const res = await api('GET', '/api/stats', { token: tokenFor(user) });
    expect(res.status).toBe(403);
  });

  it('un especialista también recibe 403: tiene su propio panel', async () => {
    const org = await createOrg();
    const { user } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });

    const res = await api('GET', '/api/stats', { token: tokenFor(user) });
    expect(res.status).toBe(403);
  });

  it('el administrador sigue recibiendo sus estadísticas', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeTruthy();
    expect(res.body.charts).toBeTruthy();
  });

  it('el motivo que escribió un paciente no le llega a otro paciente', async () => {
    const org = await createOrg();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const paciente = await createUser({ organizationId: org.id });
    const curioso = await createUser({ organizationId: org.id });

    const cita = await createAppointment({ student: paciente, specialist, organizationId: org.id });
    await prisma.appointment.update({
      where: { id: cita.id },
      data: { motivo: 'un motivo que nadie más tiene por qué leer' },
    });

    const res = await api('GET', '/api/stats', { token: tokenFor(curioso) });

    expect(res.status).toBe(403);
    // Y por si alguien relajara el código de estado: el texto no viaja.
    expect(JSON.stringify(res.body)).not.toContain('nadie más tiene por qué leer');
  });
});

describe('POST /api/appointments: un especialista agenda en su agenda y con sus pacientes', () => {
  /** Organización con dos especialistas de Psicología y un paciente. */
  async function escenario() {
    const org = await createOrg();
    const atacante = await createSpecialist({ organizationId: org.id, department: 'Psicología', name: 'Atacante' });
    const colega = await createSpecialist({ organizationId: org.id, department: 'Psicología', name: 'Colega' });
    const paciente = await createUser({ organizationId: org.id });
    return { org, atacante, colega, paciente };
  }

  // `motivo` es obligatorio en el esquema (Appointment.motivo es String, sin
  // default). La ruta no lo valida, así que omitirlo devuelve un 500 en vez de
  // un 400: anotado aparte, no es lo que estas pruebas cubren.
  const cita = (specialistId: string, studentId: string) => ({
    specialistId,
    studentId,
    date: isoDaysFromNow(3),
    time: '11:00',
    modality: 'Virtual',
    motivo: 'Consulta de prueba',
  });

  it('no puede agendar en la agenda de un colega', async () => {
    const { atacante, colega, paciente } = await escenario();
    // El atacante ya atiende al paciente, para aislar la condición que se prueba
    await createAppointment({ student: paciente, specialist: atacante.specialist, organizationId: paciente.organizationId, time: '08:00' });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(atacante.user),
      body: cita(colega.specialist.id, paciente.id),
    });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/propia agenda/i);

    const enLaAgendaAjena = await prisma.appointment.count({ where: { specialistId: colega.specialist.id } });
    expect(enLaAgendaAjena).toBe(0);
  });

  it('no puede emparejarse con un paciente que nunca ha atendido', async () => {
    const { atacante, paciente } = await escenario();

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(atacante.user),
      body: cita(atacante.specialist.id, paciente.id),
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NO_PRIOR_RELATION');
    expect(await prisma.appointment.count()).toBe(0);
  });

  it('y por tanto sigue sin poder abrir su expediente', async () => {
    const { org, atacante, paciente } = await escenario();

    // Un tercero atiende al paciente y le deja una nota
    const tratante = await createSpecialist({ organizationId: org.id, department: 'Psicología', name: 'Tratante' });
    const sesion = await createAppointment({
      student: paciente, specialist: tratante.specialist, organizationId: org.id, status: 'Completada',
    });
    await prisma.clinicalNote.create({
      data: {
        appointmentId: sesion.id,
        specialistId: tratante.specialist.id,
        studentId: paciente.id,
        department: 'Psicología',
        organizationId: org.id,
        body: 'contenido clínico confidencial',
      },
    });

    // El atacante intenta fabricarse la relación de atención...
    const intento = await api('POST', '/api/appointments', {
      token: tokenFor(atacante.user),
      body: cita(atacante.specialist.id, paciente.id),
    });
    expect(intento.status).toBe(403);

    // ...y el expediente le sigue cerrado
    const expediente = await api('GET', `/api/patients/${paciente.id}/record`, {
      token: tokenFor(atacante.user),
    });
    expect(expediente.status).toBe(403);
    expect(JSON.stringify(expediente.body)).not.toContain('contenido clínico confidencial');
  });

  it('el seguimiento legítimo sí funciona: mismo especialista, paciente que ya atiende', async () => {
    const { org, atacante: tratante, paciente } = await escenario();
    const previa = await createAppointment({
      student: paciente, specialist: tratante.specialist, organizationId: org.id, status: 'Completada', time: '09:00',
    });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(tratante.user),
      body: { ...cita(tratante.specialist.id, paciente.id), parentId: previa.id, isFollowUp: true },
    });

    expect(res.status).toBe(201);
    // La agenda el especialista, así que nace confirmada
    expect(res.body.status).toBe('Confirmada');
    expect(res.body.specialistId).toBe(tratante.specialist.id);
  });

  it('el seguimiento no se encadena a una cita de otro especialista', async () => {
    const { org, atacante: tratante, colega, paciente } = await escenario();
    // El tratante ya atiende al paciente
    await createAppointment({ student: paciente, specialist: tratante.specialist, organizationId: org.id, time: '09:00' });
    // ...pero intenta encadenar a una cita del colega
    const ajena = await createAppointment({ student: paciente, specialist: colega.specialist, organizationId: org.id, time: '10:00' });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(tratante.user),
      body: { ...cita(tratante.specialist.id, paciente.id), parentId: ajena.id, isFollowUp: true },
    });

    expect(res.status).toBe(422);
  });

  it('el alumno sigue agendando para sí mismo sin relación previa', async () => {
    const org = await createOrg();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const alumno = await createUser({ organizationId: org.id });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(alumno),
      body: cita(specialist.id, alumno.id),
    });

    expect(res.status).toBe(201);
    // La pide el alumno, así que queda pendiente de que el especialista confirme
    expect(res.body.status).toBe('Pendiente');
  });

  it('la creación de una cita queda auditada, porque autoriza el acceso al expediente', async () => {
    const org = await createOrg();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const alumno = await createUser({ organizationId: org.id });

    const res = await api('POST', '/api/appointments', {
      token: tokenFor(alumno),
      body: cita(specialist.id, alumno.id),
    });
    expect(res.status).toBe(201);

    // `writeAudit` es fire-and-forget: la respuesta no espera a que se escriba.
    const entry = await waitFor(
      () => prisma.auditLog.findFirst({ where: { action: 'APPOINTMENT_CREATED' } }),
      { label: 'la entrada de auditoría de la cita' },
    );
    expect(entry.actorId).toBe(alumno.id);
    expect((entry.metadata as any).studentId).toBe(alumno.id);
    expect((entry.metadata as any).specialistId).toBe(specialist.id);
  });
});
