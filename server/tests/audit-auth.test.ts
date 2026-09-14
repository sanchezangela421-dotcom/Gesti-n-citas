import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api } from './helpers/api';
import { createOrg, createUser, TEST_PASSWORD } from './helpers/factories';

/**
 * Auditoría de los eventos de autenticación.
 *
 * Hasta ahora la bitácora solo registraba mutaciones administrativas: quién creó
 * una organización, quién dio de baja a alguien. **Los accesos no dejaban
 * rastro**, así que una fuerza bruta contra la cuenta de un especialista no
 * aparecía en ninguna parte.
 *
 * Lo que se prueba aquí, además de que las entradas se escriban, es la
 * propiedad que hace útil al registro: **la respuesta HTTP es deliberadamente
 * vaga y la bitácora sabe más que ella**. Al cliente se le dice siempre
 * "Credenciales inválidas"; el registro guarda si el correo no existía, si la
 * contraseña estaba mal o si la cuenta estaba dada de baja, que son incidentes
 * distintos.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

const UA = 'Mozilla/5.0 (QA-Bot) PruebaDeAuditoria/1.0';

/** Intento de acceso con un `User-Agent` reconocible. */
function login(email: string, password: string) {
  return api('POST', '/api/auth/login', {
    body: { email, password },
    headers: { 'User-Agent': UA },
  });
}

/** Última entrada de la bitácora para esa acción. */
async function lastEntry(action: string) {
  return prisma.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } });
}

/** Motivo registrado del último acceso rechazado. */
async function lastFailureReason(): Promise<string | undefined> {
  const entry = await lastEntry('LOGIN_FAILED');
  return (entry?.metadata as any)?.reason;
}

describe('acceso concedido', () => {
  it('registra el acceso con IP y navegador', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    const res = await login(user.email, TEST_PASSWORD);
    expect(res.status).toBe(200);

    const entry = await lastEntry('LOGIN_SUCCESS');
    expect(entry).not.toBeNull();
    expect(entry!.actorId).toBe(user.id);
    expect(entry!.actorRole).toBe('alumno');
    expect(entry!.organizationId).toBe(org.id);
    // Las dos mitades que caracterizan un intento. Antes solo se guardaba la IP:
    // una persona y un script se veían exactamente igual.
    expect(entry!.ipAddress).toBeTruthy();
    expect(entry!.userAgent).toBe(UA);
  });

  it('recorta un User-Agent desmedido', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    // La cabecera la elige quien llama: sin tope, cada petición podría escribir
    // kilobytes por fila, que es una forma barata de inflar la tabla.
    await api('POST', '/api/auth/login', {
      body: { email: user.email, password: TEST_PASSWORD },
      headers: { 'User-Agent': 'A'.repeat(5000) },
    });

    const entry = await lastEntry('LOGIN_SUCCESS');
    expect(entry!.userAgent!.length).toBeLessThanOrEqual(512);
  });
});

describe('accesos rechazados: la bitácora sabe más que la respuesta', () => {
  it('correo inexistente queda como user_not_found, sin actor', async () => {
    const res = await login('nadie@test.local', 'loquesea');

    expect(res.status).toBe(401);
    expect(await lastFailureReason()).toBe('user_not_found');

    const entry = await lastEntry('LOGIN_FAILED');
    // No hay a quién atribuirlo, pero el intento SÍ debe quedar: es lo que
    // delata a alguien recorriendo una lista de correos.
    expect(entry!.actorId).toBe('unknown');
    expect((entry!.metadata as any).email).toBe('nadie@test.local');
  });

  it('contraseña incorrecta queda como wrong_password, con el actor real', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    const res = await login(user.email, 'contrasena-incorrecta');

    expect(res.status).toBe(401);
    expect(await lastFailureReason()).toBe('wrong_password');
    // Aquí sí se sabe a quién atacaban: es la diferencia entre un tanteo masivo
    // y la insistencia sobre una cuenta concreta.
    expect((await lastEntry('LOGIN_FAILED'))!.actorId).toBe(user.id);
  });

  it('las dos respuestas anteriores son indistinguibles para el cliente', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    const inexistente = await login('otro-que-no-existe@test.local', 'x');
    const malaClave   = await login(user.email, 'contrasena-incorrecta');

    // Que la bitácora distinga no debe filtrarse al cliente: si la respuesta
    // revelara cuál correo existe, el registro serviría de poco.
    expect(inexistente.status).toBe(malaClave.status);
    expect(inexistente.body.error).toBe(malaClave.body.error);
  });

  it('cuenta dada de baja queda como account_deactivated', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id, deletedAt: new Date() });

    const res = await login(user.email, TEST_PASSWORD);

    expect(res.status).toBe(403);
    expect(await lastFailureReason()).toBe('account_deactivated');
  });

  it('organización suspendida queda como org_suspended', async () => {
    const org = await createOrg({ active: false });
    const user = await createUser({ organizationId: org.id });

    const res = await login(user.email, TEST_PASSWORD);

    expect(res.status).toBe(403);
    expect(await lastFailureReason()).toBe('org_suspended');
  });

  it('correo sin verificar queda como email_not_verified', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id, emailVerified: false });

    const res = await login(user.email, TEST_PASSWORD);

    expect(res.status).toBe(403);
    expect(await lastFailureReason()).toBe('email_not_verified');
  });

  it('un superadmin entrando por la puerta normal queda registrado', async () => {
    const sa = await createUser({ role: UserRole.superadmin, organizationId: null });

    const res = await login(sa.email, TEST_PASSWORD);

    expect(res.status).toBe(403);
    // Con la contraseña correcta: o se equivocó de puerta, o alguien con sus
    // credenciales está tanteando por dónde entrar. Las dos cosas hay que verlas.
    expect(await lastFailureReason()).toBe('superadmin_via_user_login');
  });
});

describe('alta de cuenta', () => {
  it('registra el alta con IP y navegador', async () => {
    const org = await createOrg();

    const res = await api('POST', '/api/auth/register', {
      body: { email: 'recien-llegado@mail.com', password: 'Test1234', name: 'Recién Llegado', organizationId: org.id },
      headers: { 'User-Agent': UA },
    });
    expect(res.status).toBe(201);

    const entry = await lastEntry('REGISTER_SUCCESS');
    expect(entry).not.toBeNull();
    expect(entry!.organizationId).toBe(org.id);
    expect(entry!.userAgent).toBe(UA);
    expect((entry!.metadata as any).email).toBe('recien-llegado@mail.com');
  });
});

describe('recuperación de contraseña', () => {
  it('un correo que sí existe queda como entregado', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    await api('POST', '/api/auth/forgot-password', { body: { email: user.email }, headers: { 'User-Agent': UA } });

    const entry = await lastEntry('PASSWORD_RESET_REQUESTED');
    expect((entry!.metadata as any).delivered).toBe(true);
    expect(entry!.actorId).toBe(user.id);
  });

  it('un correo que no existe TAMBIÉN se registra', async () => {
    const res = await api('POST', '/api/auth/forgot-password', { body: { email: 'fantasma@test.local' } });

    // La respuesta es la misma para no revelar qué correos existen…
    expect(res.status).toBe(200);

    // …pero recorrer este endpoint con una lista es una forma de enumerar
    // cuentas, y sin registrar los fallidos no habría manera de verlo.
    const entry = await lastEntry('PASSWORD_RESET_REQUESTED');
    expect((entry!.metadata as any).delivered).toBe(false);
    expect((entry!.metadata as any).reason).toBe('user_not_found');
  });

  it('un enlace inválido queda registrado como intento fallido', async () => {
    const res = await api('POST', '/api/auth/reset-password', {
      body: { token: 'token-inventado-que-no-existe', password: 'NuevaClave1' },
    });

    expect(res.status).toBe(400);
    const entry = await lastEntry('PASSWORD_RESET_FAILED');
    expect((entry!.metadata as any).reason).toBe('invalid_token');
  });

  it('un enlace caducado se distingue de uno inválido', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: 'token-caducado',
        resetPasswordTokenExpiresAt: new Date(Date.now() - 60_000),
      },
    });

    await api('POST', '/api/auth/reset-password', {
      body: { token: 'token-caducado', password: 'NuevaClave1' },
    });

    const entry = await lastEntry('PASSWORD_RESET_FAILED');
    expect((entry!.metadata as any).reason).toBe('expired_token');
  });

  it('el cambio efectivo de contraseña queda registrado', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: 'token-bueno',
        resetPasswordTokenExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const res = await api('POST', '/api/auth/reset-password', {
      body: { token: 'token-bueno', password: 'NuevaClave1' },
      headers: { 'User-Agent': UA },
    });
    expect(res.status).toBe(200);

    // Es la acción con la que se recupera una cuenta comprometida, y también
    // con la que se secuestra: tiene que quedar registrada en ambos casos.
    const entry = await lastEntry('PASSWORD_RESET_COMPLETED');
    expect(entry!.actorId).toBe(user.id);
    expect(entry!.userAgent).toBe(UA);
  });
});

describe('la escritura de seguridad se espera, no se dispara al vuelo', () => {
  it('la entrada ya está guardada cuando la respuesta llega', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    await login(user.email, TEST_PASSWORD);

    // Sin `await` en la escritura, esta consulta inmediata podía no encontrar
    // nada: la respuesta salía antes de que la entrada llegara a la base, y un
    // reinicio en ese hueco se llevaba justo el registro que interesa.
    const entry = await prisma.auditLog.findFirst({
      where: { action: 'LOGIN_SUCCESS', actorId: user.id },
    });
    expect(entry).not.toBeNull();
  });
});
