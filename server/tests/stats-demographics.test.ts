import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment } from './helpers/factories';

/**
 * Demografía y desglose por departamento del endpoint de estadísticas.
 *
 * Este cálculo vivía en el navegador: el panel se traía todas las citas y todos
 * los usuarios para armarlo, y el generador de PDF repetía la misma lógica por su
 * cuenta. Eran tres implementaciones del mismo número que podían discrepar. Al
 * moverlo aquí, la pantalla y el reporte leen la misma fuente por construcción.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** Fecha de nacimiento que hoy corresponde a la edad pedida. */
function birthDateForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 1); // un día de margen para no caer justo en el cumpleaños
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function orgWithAdmin() {
  const org = await createOrg();
  const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
  return { org, admin };
}

describe('distribución de edad', () => {
  it('ubica a cada persona en su rango etario', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });

    const joven = await createUser({ organizationId: org.id });
    const mayor = await createUser({ organizationId: org.id });
    await prisma.user.update({ where: { id: joven.id }, data: { fechaNacimiento: birthDateForAge(19) } });
    await prisma.user.update({ where: { id: mayor.id }, data: { fechaNacimiento: birthDateForAge(30) } });

    await createAppointment({ student: joven, specialist, organizationId: org.id, time: '09:00' });
    await createAppointment({ student: mayor, specialist, organizationId: org.id, time: '10:00' });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.status).toBe(200);
    const rango = (name: string) => res.body.charts.edad.find((r: any) => r.name === name)?.value;
    expect(rango('18–20')).toBe(1);
    expect(rango('27+')).toBe(1);
    expect(rango('21–23')).toBe(0);
  });

  it('lee la fecha del campo dinámico aunque la clave se haya guardado normalizada', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });

    // Ésta es la forma que produce el panel del superadmin: minúsculas, sin camelCase.
    const alumno = await createUser({ organizationId: org.id });
    await prisma.user.update({
      where: { id: alumno.id },
      data: { fechaNacimiento: null, metadata: { fechanacimiento: birthDateForAge(22) } },
    });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.body.charts.edad.find((r: any) => r.name === '21–23')?.value).toBe(1);
  });

  it('devuelve todos los rangos aunque vengan en cero', async () => {
    const { admin } = await orgWithAdmin();
    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.body.charts.edad.map((r: any) => r.name))
      .toEqual(['15–17', '18–20', '21–23', '24–26', '27+']);
  });

  it('una fecha inválida no rompe el endpoint ni inventa un rango', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });
    const alumno = await createUser({ organizationId: org.id });
    await prisma.user.update({ where: { id: alumno.id }, data: { fechaNacimiento: 'no-es-fecha' } });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.status).toBe(200);
    const total = res.body.charts.edad.reduce((n: number, r: any) => n + r.value, 0);
    expect(total).toBe(0);
  });
});

describe('distribución por género', () => {
  it('cuenta citas y rescata el valor desde metadata', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });

    const conColumna = await createUser({ organizationId: org.id });
    await prisma.user.update({ where: { id: conColumna.id }, data: { genero: 'Femenino' } });

    const conMetadata = await createUser({ organizationId: org.id });
    await prisma.user.update({
      where: { id: conMetadata.id },
      data: { genero: null, metadata: { 'Género': 'Masculino' } },
    });

    await createAppointment({ student: conColumna, specialist, organizationId: org.id, time: '09:00' });
    await createAppointment({ student: conColumna, specialist, organizationId: org.id, time: '10:00' });
    await createAppointment({ student: conMetadata, specialist, organizationId: org.id, time: '11:00' });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    const g = (name: string) => res.body.charts.genero.find((x: any) => x.name === name)?.value;
    expect(g('Femenino')).toBe(2);
    expect(g('Masculino')).toBe(1);
  });
});

describe('desglose por departamento', () => {
  it('cada departamento trae su propio bloque y suman el total global', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist: psico } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const { specialist: nutri } = await createSpecialist({ organizationId: org.id, department: 'Nutrición' });
    const alumno = await createUser({ organizationId: org.id });

    await createAppointment({ student: alumno, specialist: psico, organizationId: org.id, time: '09:00' });
    await createAppointment({ student: alumno, specialist: psico, organizationId: org.id, time: '10:00' });
    await createAppointment({ student: alumno, specialist: nutri, organizationId: org.id, time: '11:00' });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.body.byDepartment['Psicología'].summary.total).toBe(2);
    expect(res.body.byDepartment['Nutrición'].summary.total).toBe(1);
    expect(res.body.byDepartment['Tutorías'].summary.total).toBe(0);

    const suma = Object.values(res.body.byDepartment)
      .reduce((n: number, b: any) => n + b.summary.total, 0);
    expect(suma).toBe(res.body.summary.total);
  });

  it('el bloque por departamento trae las mismas gráficas que el global', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id, department: 'Psicología' });
    const alumno = await createUser({ organizationId: org.id, carrera: 'Ing. en Sistemas' });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    const claves = ['monthly', 'motivos', 'modalidad', 'carrera', 'genero', 'semestre', 'edad', 'byField'];
    for (const k of claves) {
      expect(res.body.charts).toHaveProperty(k);
      expect(res.body.byDepartment['Psicología'].charts).toHaveProperty(k);
    }
  });

  it('solo incluye los departamentos que la organización tiene contratados', async () => {
    const { org, admin } = await orgWithAdmin();
    await prisma.organization.update({
      where: { id: org.id },
      data: { departments: ['Psicología'] },
    });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(Object.keys(res.body.byDepartment)).toEqual(['Psicología']);
    expect(res.body.departments).toEqual(['Psicología']);
  });
});

describe('inasistencias y seguimientos', () => {
  it('el resumen las cuenta y el total cuadra con la suma de estados', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });
    const alumno = await createUser({ organizationId: org.id });

    for (const [time, status] of [['09:00', 'Completada'], ['10:00', 'No asistió'], ['11:00', 'Cancelada']] as const) {
      await createAppointment({ student: alumno, specialist, organizationId: org.id, time, status });
    }

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });
    const s = res.body.summary;

    expect(s.noAsistio).toBe(1);
    expect(s.pendientes + s.confirmadas + s.completadas + s.canceladas + s.noAsistio).toBe(s.total);
  });
});

describe('campos propios de la organización', () => {
  it('grafica los campos select/radio que definió la organización', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });

    await prisma.registrationField.create({
      data: {
        organizationId: org.id, key: 'turno', label: 'Turno',
        type: 'select', required: false, order: 1, options: ['Matutino', 'Vespertino'],
      },
    });

    const a = await createUser({ organizationId: org.id });
    const b = await createUser({ organizationId: org.id });
    await prisma.user.update({ where: { id: a.id }, data: { metadata: { turno: 'Matutino' } } });
    await prisma.user.update({ where: { id: b.id }, data: { metadata: { turno: 'Vespertino' } } });
    await createAppointment({ student: a, specialist, organizationId: org.id, time: '09:00' });
    await createAppointment({ student: b, specialist, organizationId: org.id, time: '10:00' });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    const turno = res.body.charts.byField.find((f: any) => f.key === 'turno');
    expect(turno.label).toBe('Turno');
    expect(turno.data.find((d: any) => d.name === 'Matutino').value).toBe(1);
    expect(turno.data.find((d: any) => d.name === 'Vespertino').value).toBe(1);
  });

  it('omite el campo si nadie lo respondió, en vez de pintar "No especificado" para todos', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });

    await prisma.registrationField.create({
      data: {
        organizationId: org.id, key: 'modalidad_estudio', label: 'Modalidad de estudio',
        type: 'radio', required: false, order: 1, options: ['Escolarizado', 'Mixto'],
      },
    });

    const alumno = await createUser({ organizationId: org.id });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.body.charts.byField.find((f: any) => f.key === 'modalidad_estudio')).toBeUndefined();
  });

  it('no duplica la gráfica de un campo que ya tiene una dedicada', async () => {
    const { org, admin } = await orgWithAdmin();
    const { specialist } = await createSpecialist({ organizationId: org.id });

    // "Género" con acento: la clave se guarda distinta de 'genero' pero es el mismo campo.
    await prisma.registrationField.create({
      data: {
        organizationId: org.id, key: 'género', label: 'Género',
        type: 'radio', required: false, order: 1, options: ['Masculino', 'Femenino'],
      },
    });

    const alumno = await createUser({ organizationId: org.id });
    await prisma.user.update({ where: { id: alumno.id }, data: { metadata: { 'género': 'Femenino' } } });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.body.charts.byField.find((f: any) => f.label === 'Género')).toBeUndefined();
    expect(res.body.charts.genero.find((g: any) => g.name === 'Femenino')?.value).toBe(1);
  });
});
