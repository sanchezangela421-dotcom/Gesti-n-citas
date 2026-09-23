import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api } from './helpers/api';
import { createOrg, createUser, TEST_PASSWORD } from './helpers/factories';

/**
 * Tipos de los campos que llegan en el cuerpo de las peticiones de autenticación.
 *
 * `req.body` es `any`. Express parsea el JSON tal cual venga, así que un campo
 * que el código espera como cadena puede llegar como objeto, número o null y
 * viajar intacto hasta donde se use.
 *
 * Donde más caro sale es en `reset-password`: el token se usaba como valor de
 * una condición de Prisma, y Prisma interpreta un objeto en esa posición como un
 * FILTRO sobre la columna, no como el valor a comparar. Que eso es así se ve en
 * el propio proyecto: `stats.ts` filtra `User.id` —una columna String— con
 * `{ in: [...] }`, y `specialists.ts` filtra `Appointment.date` con
 * `{ gte, lte }`. El resultado era que una petición sin autenticar podía
 * seleccionar la cuenta de otra persona sin haber recibido jamás su enlace.
 *
 * Estas pruebas fijan las dos mitades del arreglo: que un campo con el tipo
 * equivocado se rechaza antes de tocar la base, y que el camino legítimo sigue
 * funcionando igual.
 *
 * Nota: el límite de peticiones está desactivado bajo NODE_ENV=test
 * (`app.ts`), así que la adición de `/api/auth/reset-password` al limitador
 * estricto no se ejerce aquí; se verifica leyendo `app.ts`.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

/** Cuenta con un enlace de recuperación vivo, como tras pedir "olvidé mi contraseña". */
async function userWithLiveResetToken(token: string, opts: { role?: UserRole } = {}) {
  const org = await createOrg();
  const user = await createUser({ organizationId: org.id, role: opts.role ?? UserRole.alumno });
  return prisma.user.update({
    where: { id: user.id },
    data: {
      resetPasswordToken: token,
      resetPasswordTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

/** Formas de operador de Prisma que un cliente podría mandar en lugar del token. */
const OPERATOR_SHAPES: Array<[string, unknown]> = [
  ['objeto con un operador de negación', { not: null }],
  ['objeto con un operador de prefijo', { startsWith: '' }],
  ['objeto con un operador de contenido', { contains: '' }],
  ['arreglo', ['a', 'b']],
  ['número', 12345],
];

describe('reset-password: el token tiene que ser una cadena', () => {
  it.each(OPERATOR_SHAPES)(
    'rechaza un token que llega como %s y no toca ninguna cuenta',
    async (_label, shape) => {
      const victim = await userWithLiveResetToken('t0ken-de-la-victima');

      const res = await api('POST', '/api/auth/reset-password', {
        body: { token: shape, password: 'OtraClave123' },
      });

      expect(res.status).toBe(400);

      // Lo que de verdad importa no es el código de respuesta, sino que la
      // credencial de la víctima siga intacta y su enlace siga siendo suyo.
      const after = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
      expect(after.password).toBe(victim.password);
      expect(after.resetPasswordToken).toBe('t0ken-de-la-victima');
      expect(after.tokenVersion).toBe(victim.tokenVersion);
      expect(after.emailVerified).toBe(victim.emailVerified);
    },
  );

  it('tampoco alcanza a una cuenta de superadmin', async () => {
    const operator = await userWithLiveResetToken('t0ken-del-superadmin', { role: UserRole.superadmin });

    const res = await api('POST', '/api/auth/reset-password', {
      body: { token: { not: null }, password: 'OtraClave123' },
    });

    expect(res.status).toBe(400);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: operator.id } });
    expect(after.password).toBe(operator.password);
    expect(after.resetPasswordToken).toBe('t0ken-del-superadmin');
  });

  it('el camino legítimo sigue funcionando con el token correcto', async () => {
    const user = await userWithLiveResetToken('t0ken-correcto');

    const res = await api('POST', '/api/auth/reset-password', {
      body: { token: 't0ken-correcto', password: 'ClaveNueva123' },
    });

    expect(res.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.password).not.toBe(user.password);
    expect(after.resetPasswordToken).toBeNull();
    // Cambiar la contraseña invalida las sesiones abiertas con la anterior.
    expect(after.tokenVersion).toBe(user.tokenVersion + 1);

    const login = await api('POST', '/api/auth/login', {
      body: { email: user.email, password: 'ClaveNueva123' },
    });
    expect(login.status).toBe(200);
  });

  it('un enlace vencido se rechaza y además se limpia de la columna', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: 't0ken-vencido',
        resetPasswordTokenExpiresAt: new Date(Date.now() - 60 * 1000),
      },
    });

    const res = await api('POST', '/api/auth/reset-password', {
      body: { token: 't0ken-vencido', password: 'ClaveNueva123' },
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EXPIRED_TOKEN');

    // Se limpia: un token vencido que se queda en la columna es una fila más que
    // cualquier consulta futura sobre esa columna puede emparejar.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.resetPasswordToken).toBeNull();
    expect(after.resetPasswordTokenExpiresAt).toBeNull();
    expect(after.password).toBe(user.password);
  });
});

describe('login: el tipo no debe delatar si la cuenta existe', () => {
  it('responde igual para una cuenta que existe y para una que no', async () => {
    const org = await createOrg();
    const existing = await createUser({ organizationId: org.id });

    const conCuenta = await api('POST', '/api/auth/login', {
      body: { email: existing.email, password: { $ne: null } },
    });
    const sinCuenta = await api('POST', '/api/auth/login', {
      body: { email: 'nadie-aqui@test.local', password: { $ne: null } },
    });

    // Antes: 500 cuando la cuenta existía (bcrypt.compare reventaba con un
    // no-string) y 401 cuando no. La diferencia confirmaba la existencia.
    expect(conCuenta.status).toBe(401);
    expect(sinCuenta.status).toBe(401);
    expect(conCuenta.body).toEqual(sinCuenta.body);
  });

  it('un correo que no es cadena tampoco produce un 500', async () => {
    const res = await api('POST', '/api/auth/login', {
      body: { email: { not: null }, password: 'loquesea' },
    });
    expect(res.status).toBe(401);
  });

  it('deja constancia del intento malformado, que no es alguien tecleando mal', async () => {
    const org = await createOrg();
    const existing = await createUser({ organizationId: org.id });

    await api('POST', '/api/auth/login', {
      body: { email: existing.email, password: { $ne: null } },
    });

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'LOGIN_FAILED' },
      orderBy: { createdAt: 'desc' },
    });
    expect((entry?.metadata as any)?.reason).toBe('malformed_credentials');
  });

  it('el login normal sigue funcionando', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    const res = await api('POST', '/api/auth/login', {
      body: { email: user.email, password: TEST_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});

describe('los demás endpoints que reciben un correo del cuerpo', () => {
  it('forgot-password tolera un correo que no es cadena sin romperse', async () => {
    const res = await api('POST', '/api/auth/forgot-password', {
      body: { email: { not: null } },
    });
    // Misma respuesta neutra de siempre: no distingue este caso de los demás.
    expect(res.status).toBe(200);
  });

  it('resend-verification tolera un correo que no es cadena sin romperse', async () => {
    const res = await api('POST', '/api/auth/resend-verification', {
      body: { email: ['a@test.local'] },
    });
    expect(res.status).toBe(200);
  });

  it('forgot-password sigue emitiendo el enlace para un correo real', async () => {
    const org = await createOrg();
    const user = await createUser({ organizationId: org.id });

    const res = await api('POST', '/api/auth/forgot-password', { body: { email: user.email } });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.resetPasswordToken).toBeTruthy();
  });
});
