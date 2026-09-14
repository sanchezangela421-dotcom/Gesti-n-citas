import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor, waitFor } from './helpers/api';
import { createOrg, createUser } from './helpers/factories';

/**
 * Bitácora consultable y registro de las consultas del superadmin.
 *
 * Antes `GET /superadmin/audit` solo filtraba por organización y paginaba: con
 * volumen real, responder *"todos los intentos fallidos desde esta IP"* era
 * imposible desde la pantalla, y el registro no servía para lo que se construyó.
 *
 * La otra mitad es que **las consultas del superadmin no dejaban rastro**. Puede
 * leer los datos de todas las organizaciones, así que quien se apodere de esa
 * sesión no necesita modificar nada para hacer daño: le basta con mirar.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function superadminToken() {
  const sa = await createUser({ organizationId: null, role: UserRole.superadmin });
  return tokenFor(sa);
}

/** Escribe una entrada directamente: aquí se prueba la consulta, no quién la generó. */
function entry(over: Partial<{
  actorId: string; action: string; ipAddress: string;
  organizationId: string | null; metadata: object; createdAt: Date;
}> = {}) {
  return prisma.auditLog.create({
    data: {
      actorId: over.actorId ?? 'actor-1',
      actorRole: 'superadmin',
      action: over.action ?? 'LOGIN_SUCCESS',
      targetEntity: 'Auth',
      targetId: 'x',
      organizationId: over.organizationId ?? null,
      ipAddress: over.ipAddress ?? '10.0.0.1',
      metadata: over.metadata ?? {},
      ...(over.createdAt ? { createdAt: over.createdAt } : {}),
    },
  });
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d;
}

describe('filtros de la bitácora', () => {
  it('filtra por acción', async () => {
    const token = await superadminToken();
    await entry({ action: 'LOGIN_FAILED' });
    await entry({ action: 'LOGIN_FAILED' });
    await entry({ action: 'LOGIN_SUCCESS' });

    const res = await api('GET', '/api/superadmin/audit?action=LOGIN_FAILED', { token });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.entries.every((e: any) => e.action === 'LOGIN_FAILED')).toBe(true);
  });

  it('filtra por IP — la pregunta típica tras un ataque', async () => {
    const token = await superadminToken();
    await entry({ ipAddress: '203.0.113.7', action: 'LOGIN_FAILED' });
    await entry({ ipAddress: '203.0.113.7', action: 'LOGIN_FAILED' });
    await entry({ ipAddress: '198.51.100.2', action: 'LOGIN_FAILED' });

    const res = await api('GET', '/api/superadmin/audit?ip=203.0.113.7', { token });

    expect(res.body.total).toBe(2);
  });

  it('filtra por el correo tanteado, que vive dentro de metadata', async () => {
    const token = await superadminToken();
    await entry({ action: 'LOGIN_FAILED', metadata: { email: 'victima@mail.com', reason: 'wrong_password' } });
    await entry({ action: 'LOGIN_FAILED', metadata: { email: 'victima@mail.com', reason: 'wrong_password' } });
    await entry({ action: 'LOGIN_FAILED', metadata: { email: 'otro@mail.com', reason: 'user_not_found' } });

    // Es lo que separa "alguien probando correos al azar" de "alguien
    // insistiendo sobre una cuenta concreta".
    const res = await api('GET', '/api/superadmin/audit?email=victima@mail.com', { token });

    expect(res.body.total).toBe(2);
  });

  it('filtra por actor', async () => {
    const token = await superadminToken();
    await entry({ actorId: 'sospechoso' });
    await entry({ actorId: 'normal' });

    const res = await api('GET', '/api/superadmin/audit?actorId=sospechoso', { token });
    expect(res.body.total).toBe(1);
  });

  it('filtra por rango de fechas, con ambos extremos incluidos', async () => {
    const token = await superadminToken();
    await entry({ createdAt: daysAgo(10) });
    await entry({ createdAt: daysAgo(5) });
    await entry({ createdAt: daysAgo(1) });

    const res = await api('GET', `/api/superadmin/audit?from=${isoDaysAgo(5)}&to=${isoDaysAgo(1)}`, { token });

    // El día indicado en `to` cuenta entero: quien consulta piensa en días, no
    // en instantes.
    expect(res.body.total).toBe(2);
  });

  it('combina filtros', async () => {
    const token = await superadminToken();
    await entry({ action: 'LOGIN_FAILED', ipAddress: '203.0.113.7' });
    await entry({ action: 'LOGIN_FAILED', ipAddress: '198.51.100.2' });
    await entry({ action: 'LOGIN_SUCCESS', ipAddress: '203.0.113.7' });

    const res = await api('GET', '/api/superadmin/audit?action=LOGIN_FAILED&ip=203.0.113.7', { token });
    expect(res.body.total).toBe(1);
  });

  it('sin filtros devuelve todo, como antes', async () => {
    const token = await superadminToken();
    await entry(); await entry(); await entry();

    const res = await api('GET', '/api/superadmin/audit', { token });
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.pageSize).toBe(100);
  });

  it('rechaza una fecha con formato inválido en vez de ignorarla', async () => {
    const token = await superadminToken();
    // Ignorarla en silencio daría un resultado que parece correcto y no lo es.
    const res = await api('GET', '/api/superadmin/audit?from=13-09-2026', { token });
    expect(res.status).toBe(400);
  });

  it('rechaza un rango invertido', async () => {
    const token = await superadminToken();
    const res = await api('GET', `/api/superadmin/audit?from=${isoDaysAgo(1)}&to=${isoDaysAgo(10)}`, { token });
    expect(res.status).toBe(422);
  });

  it('exige sesión de superadmin', async () => {
    const alumno = await createUser({ organizationId: (await createOrg()).id });
    const res = await api('GET', '/api/superadmin/audit', { token: tokenFor(alumno) });
    expect(res.status).toBe(403);
  });
});

describe('catálogo de acciones para el selector', () => {
  it('devuelve las acciones existentes con su conteo', async () => {
    const token = await superadminToken();
    await entry({ action: 'LOGIN_FAILED' });
    await entry({ action: 'LOGIN_FAILED' });
    await entry({ action: 'CREATE_ORGANIZATION' });

    const res = await api('GET', '/api/superadmin/audit/actions', { token });

    expect(res.status).toBe(200);
    const fallidos = res.body.find((a: any) => a.action === 'LOGIN_FAILED');
    expect(fallidos.count).toBe(2);
    // Se consultan en vez de escribirlas en el frontend: una lista fija se
    // desfasa en cuanto se añade un evento nuevo.
    expect(res.body.map((a: any) => a.action)).toContain('CREATE_ORGANIZATION');
  });
});

describe('las consultas del superadmin dejan rastro', () => {
  it('consultar el listado de usuarios queda registrado con su alcance', async () => {
    const org = await createOrg();
    await createUser({ organizationId: org.id });
    const token = await superadminToken();

    await api('GET', `/api/superadmin/users?orgId=${org.id}`, { token });

    const registro = await waitFor(
      async () => {
        const r = await prisma.auditLog.findFirst({ where: { action: 'SUPERADMIN_USERS_VIEWED' } });
        return r ?? null;
      },
      { label: 'el registro de la consulta de usuarios' },
    );

    const meta = registro.metadata as any;
    // Se guarda el ALCANCE de lo que vio, no las filas: copiarlas duplicaría los
    // datos personales en otra tabla.
    expect(meta.filtro.orgId).toBe(org.id);
    expect(typeof meta.filas).toBe('number');
    expect(registro.ipAddress).toBeTruthy();
  });

  it('consultar el listado de organizaciones queda registrado', async () => {
    await createOrg();
    const token = await superadminToken();

    await api('GET', '/api/superadmin/organizations', { token });

    const registro = await waitFor(
      async () => {
        const r = await prisma.auditLog.findFirst({ where: { action: 'SUPERADMIN_ORGS_VIEWED' } });
        return r ?? null;
      },
      { label: 'el registro de la consulta de organizaciones' },
    );
    expect((registro.metadata as any).filas).toBeGreaterThanOrEqual(1);
  });

  it('consultar la propia bitácora NO se registra', async () => {
    const token = await superadminToken();

    await api('GET', '/api/superadmin/audit', { token });
    await api('GET', '/api/superadmin/audit/actions', { token });

    // Sería ruido que crece solo y entierra justo lo que se viene a buscar.
    const total = await prisma.auditLog.count();
    expect(total).toBe(0);
  });
});
