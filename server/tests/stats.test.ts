import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist, createAppointment } from './helpers/factories';

/**
 * Estadísticas del panel de admin.
 *
 * Todas las gráficas de este endpoint cuentan CITAS. La de carrera contaba
 * alumnos distintos, así que el mismo gráfico daba números diferentes según se
 * leyera del servidor o del cálculo propio del panel.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

describe('distribución por carrera', () => {
  it('cuenta citas, no alumnos distintos', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const { specialist } = await createSpecialist({ organizationId: org.id });

    // Un solo alumno de Sistemas con TRES citas: la carrera debe sumar 3, no 1
    const alumno = await createUser({ organizationId: org.id, carrera: 'Ing. en Sistemas' });
    for (const time of ['09:00', '10:00', '11:00']) {
      await createAppointment({ student: alumno, specialist, organizationId: org.id, time });
    }

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    expect(res.status).toBe(200);
    const sistemas = res.body.charts.carrera.find((c: any) => c.name === 'Ing. en Sistemas');
    expect(sistemas.value).toBe(3);
  });

  it('el total por carrera cuadra con el total de citas', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const { specialist } = await createSpecialist({ organizationId: org.id });

    const a = await createUser({ organizationId: org.id, carrera: 'Ing. Industrial' });
    const b = await createUser({ organizationId: org.id, carrera: 'Ing. en Sistemas' });
    await createAppointment({ student: a, specialist, organizationId: org.id, time: '09:00' });
    await createAppointment({ student: a, specialist, organizationId: org.id, time: '10:00' });
    await createAppointment({ student: b, specialist, organizationId: org.id, time: '11:00' });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    const sumaCarreras = res.body.charts.carrera.reduce((n: number, c: any) => n + c.value, 0);
    expect(sumaCarreras).toBe(res.body.summary.total);
    expect(sumaCarreras).toBe(3);
  });

  it('usa el campo dinámico de metadata cuando la columna legacy está vacía', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const { specialist } = await createSpecialist({ organizationId: org.id });

    // Alta sin la columna legacy, solo con el campo dinámico de registro
    const alumno = await createUser({ organizationId: org.id });
    await prisma.user.update({
      where: { id: alumno.id },
      data: { carrera: null, metadata: { carrera: 'Arquitectura' } },
    });
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    const arq = res.body.charts.carrera.find((c: any) => c.name === 'Arquitectura');
    expect(arq?.value).toBe(1);
  });

  it('agrupa como "no especificada" a quien no tiene carrera', async () => {
    const org = await createOrg();
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    const { specialist } = await createSpecialist({ organizationId: org.id });
    const alumno = await createUser({ organizationId: org.id }); // sin carrera
    await createAppointment({ student: alumno, specialist, organizationId: org.id });

    const res = await api('GET', '/api/stats', { token: tokenFor(admin) });

    const sinCarrera = res.body.charts.carrera.find((c: any) => c.name === 'Otras / No especificada');
    expect(sinCarrera?.value).toBe(1);
  });
});
