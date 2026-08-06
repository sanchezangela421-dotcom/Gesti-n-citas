import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor, waitFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment, createClinicalNote } from './helpers/factories';

/**
 * Visibilidad del expediente clínico.
 *
 * Son datos de salud mental. El diseño acordado es "continuidad por
 * departamento, auditada": el autor siempre ve sus notas, y otro especialista
 * solo si atiende al paciente Y es del mismo departamento Y de la misma
 * organización. Cualquier otro rol —incluido el admin— nunca ve contenido
 * clínico. Cada condición se prueba por separado porque relajar una sola
 * convierte el expediente en información compartida.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** Paciente con una nota escrita por `autor` en el departamento indicado. */
async function patientWithNote(orgId: string, department = 'Psicología') {
  const student = await createUser({ organizationId: orgId, name: 'Paciente' });
  const { user: authorUser, specialist: author } = await createSpecialist({ organizationId: orgId, department, name: 'Autor' });
  const appointment = await createAppointment({
    student, specialist: author, organizationId: orgId, status: 'Completada',
  });
  const note = await createClinicalNote({
    appointmentId: appointment.id,
    specialistId: author.id,
    studentId: student.id,
    department,
    organizationId: orgId,
    body: 'Contenido clínico confidencial.',
  });
  return { student, authorUser, author, appointment, note };
}

describe('el autor accede a sus propias notas', () => {
  it('ve la nota marcada como suya', async () => {
    const org = await createOrg();
    const { student, authorUser, note } = await patientWithNote(org.id);

    const res = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(authorUser) });

    expect(res.status).toBe(200);
    const session = res.body.timeline.find((s: any) => s.note);
    expect(session.note.body).toBe(note.body);
    expect(session.note.authoredByMe).toBe(true);
  });
});

describe('continuidad de atención dentro del mismo departamento', () => {
  it('otro especialista del mismo depto que YA atiende al paciente sí ve la nota', async () => {
    const org = await createOrg();
    const { student, note } = await patientWithNote(org.id, 'Psicología');

    // Segundo especialista del mismo departamento, con cita propia con el paciente
    const { user: colleagueUser, specialist: colleague } = await createSpecialist({
      organizationId: org.id, department: 'Psicología', name: 'Colega',
    });
    await createAppointment({ student, specialist: colleague, organizationId: org.id, time: '15:00' });

    const res = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(colleagueUser) });

    expect(res.status).toBe(200);
    const withNote = res.body.timeline.find((s: any) => s.note);
    expect(withNote.note.body).toBe(note.body);
    // La ve por continuidad, no por autoría
    expect(withNote.note.authoredByMe).toBe(false);
  });

  it('un especialista SIN relación de atención no accede, aunque sea del mismo depto', async () => {
    const org = await createOrg();
    const { student } = await patientWithNote(org.id, 'Psicología');

    const { user: strangerUser } = await createSpecialist({
      organizationId: org.id, department: 'Psicología', name: 'Sin relación',
    });

    const res = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(strangerUser) });
    expect(res.status).toBe(403);
  });

  it('un especialista de OTRO departamento no ve la nota, aunque atienda al paciente', async () => {
    const org = await createOrg();
    const { student } = await patientWithNote(org.id, 'Psicología');

    // Atiende al mismo paciente, pero desde Nutrición
    const { user: nutriUser, specialist: nutri } = await createSpecialist({
      organizationId: org.id, department: 'Nutrición', name: 'Nutriólogo',
    });
    await createAppointment({ student, specialist: nutri, organizationId: org.id, time: '16:00' });

    const res = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(nutriUser) });

    expect(res.status).toBe(200);
    // Ve su propia sesión, pero ninguna nota de Psicología
    expect(res.body.department).toBe('Nutrición');
    expect(res.body.timeline.every((s: any) => s.note === null)).toBe(true);
  });

  it('un especialista de OTRA organización no accede', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const { student } = await patientWithNote(orgA.id, 'Psicología');

    const { user: outsiderUser } = await createSpecialist({
      organizationId: orgB.id, department: 'Psicología', name: 'Ajeno',
    });

    const res = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(outsiderUser) });
    expect(res.status).toBe(403);
  });
});

describe('quien no es personal clínico nunca ve el contenido', () => {
  it('el admin no puede abrir un expediente', async () => {
    const org = await createOrg();
    const { student } = await patientWithNote(org.id);
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });

    const res = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(admin) });
    expect(res.status).toBe(403);
  });

  it('el propio paciente no puede abrir su expediente por esta vía', async () => {
    const org = await createOrg();
    const { student } = await patientWithNote(org.id);

    const res = await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(student) });
    expect(res.status).toBe(403);
  });

  it('el listado de citas del alumno no expone contenido clínico', async () => {
    const org = await createOrg();
    const { student } = await patientWithNote(org.id);

    const res = await api('GET', '/api/appointments', { token: tokenFor(student) });

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('Contenido clínico confidencial');
  });
});

describe('escritura de notas', () => {
  it('solo el especialista asignado puede anotar en la cita', async () => {
    const org = await createOrg();
    const { appointment } = await patientWithNote(org.id);
    const { user: otherUser } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });

    const res = await api('PUT', `/api/appointments/${appointment.id}/note`, {
      token: tokenFor(otherUser),
      body: { body: 'Intento de escritura ajena' },
    });
    expect(res.status).toBe(404);
  });

  it('cada edición guarda el contenido anterior como revisión inmutable', async () => {
    const org = await createOrg();
    const { authorUser, appointment, note } = await patientWithNote(org.id);

    const res = await api('PUT', `/api/appointments/${appointment.id}/note`, {
      token: tokenFor(authorUser),
      body: { body: 'Contenido corregido' },
    });

    expect(res.status).toBe(200);
    const revisions = await prisma.clinicalNoteRevision.findMany({ where: { noteId: note.id } });
    expect(revisions).toHaveLength(1);
    expect(revisions[0].body).toBe('Contenido clínico confidencial.');

    const current = await prisma.clinicalNote.findUnique({ where: { id: note.id } });
    expect(current!.body).toBe('Contenido corregido');
  });

  it('deja registro de auditoría al consultar un expediente', async () => {
    const org = await createOrg();
    const { student, authorUser } = await patientWithNote(org.id);

    await api('GET', `/api/patients/${student.id}/record`, { token: tokenFor(authorUser) });

    // writeAudit es fire-and-forget: se sondea hasta que la escritura cierre,
    // en vez de dormir un tiempo fijo que fallaría bajo carga.
    const logs = await waitFor(
      async () => {
        const found = await prisma.auditLog.findMany({
          where: { action: 'CLINICAL_RECORD_VIEWED', targetId: student.id },
        });
        return found.length > 0 ? found : null;
      },
      { label: 'el registro de auditoría del expediente' },
    );
    expect(logs[0].actorId).toBe(authorUser.id);
  });
});
