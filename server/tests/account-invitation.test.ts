import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser, createSpecialist } from './helpers/factories';

/**
 * Invitaciones que no salen.
 *
 * El 2026-09-20, durante una ronda de pruebas, se venció el plan de la cuenta de
 * correo. La tester creó un administrador para una organización: la cuenta quedó
 * guardada, el correo de activación nunca salió, y el panel contestó
 * "Se envió correo con credenciales". Sin forma de reenviar la invitación ni
 * señal de que algo hubiera fallado, lo intentó cuatro veces más con variantes
 * del correo — de ahí los administradores duplicados.
 *
 * Aquí se fija la decisión de diseño y lo que la hace utilizable:
 *
 *   1. La cuenta SE GUARDA aunque el correo falle. Guardar y entregar no pueden
 *      ser atómicos —el proveedor puede aceptar el mensaje y rebotarlo después—,
 *      y borrar una cuenta recién creada por un fallo pasajero del proveedor
 *      significa que con el correo caído no se puede dar de alta a nadie.
 *   2. La respuesta DICE LA VERDAD sobre si la invitación salió.
 *   3. Existe una forma de reenviarla, que es lo único que convierte el punto 2
 *      en algo accionable.
 */

// `vi.mock` se eleva por encima de los imports: el módulo de correo crea su
// transporte al cargarse, así que el doble y las variables de entorno tienen que
// existir antes. Sin intervalo ni reintentos, cada caso tarda milisegundos.
const { sendMail } = vi.hoisted(() => {
  process.env.EMAIL_MIN_INTERVAL_MS = '1';
  process.env.EMAIL_MAX_RETRIES = '0';
  return { sendMail: vi.fn(async () => undefined) };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail }) },
}));

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

beforeEach(() => {
  sendMail.mockReset();
  sendMail.mockImplementation(async () => undefined);
});

/**
 * Lo que contesta el proveedor cuando se vence el plan: rechaza las credenciales.
 *
 * El 535 queda fuera del rango que la cola considera "bajá el ritmo" (420-499),
 * así que no se reintenta: un plan vencido no mejora esperando.
 */
function planVencido() {
  return Object.assign(new Error('Invalid login'), {
    responseCode: 535,
    response: '535 5.7.0 Invalid login: sandbox subscription expired',
  });
}

async function superadminToken() {
  const sa = await createUser({ organizationId: null, role: UserRole.superadmin });
  return tokenFor(sa);
}

let n = 0;
const correo = () => `invitado-${Date.now().toString(36)}-${++n}@test.local`;

describe('la cuenta sobrevive al fallo del correo', () => {
  it('POST /users crea el usuario aunque el proveedor rechace el envío', async () => {
    const token = await superadminToken();
    const org = await createOrg();
    const email = correo();
    sendMail.mockRejectedValue(planVencido());

    const res = await api('POST', '/api/superadmin/users', {
      token,
      body: { name: 'Admin ITCM', email, role: 'admin', organizationId: org.id },
    });

    expect(res.status).toBe(201);
    // Decisión deliberada: la cuenta se queda. Lo que falta es avisarlo.
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
  });

  it('POST /users responde invitationSent:false cuando el correo no salió', async () => {
    const token = await superadminToken();
    const org = await createOrg();
    sendMail.mockRejectedValue(planVencido());

    const res = await api('POST', '/api/superadmin/users', {
      token,
      body: { name: 'Admin ITCM', email: correo(), role: 'admin', organizationId: org.id },
    });

    expect(res.body.invitationSent).toBe(false);
  });

  it('POST /users responde invitationSent:true cuando sí salió', async () => {
    const token = await superadminToken();
    const org = await createOrg();

    const res = await api('POST', '/api/superadmin/users', {
      token,
      body: { name: 'Admin ITCM', email: correo(), role: 'admin', organizationId: org.id },
    });

    expect(res.body.invitationSent).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('designar admin de una organización también dice si la invitación salió', async () => {
    const token = await superadminToken();
    const org = await createOrg();
    const email = correo();
    sendMail.mockRejectedValue(planVencido());

    const res = await api('POST', `/api/superadmin/users/organizations/${org.id}/admin`, {
      token,
      body: { name: 'Admin ITCM', email },
    });

    expect(res.status).toBe(201);
    expect(res.body.invitationSent).toBe(false);
    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
  });
});

describe('reenviar la invitación', () => {
  it('vuelve a mandar el correo y renueva el enlace', async () => {
    const token = await superadminToken();
    const org = await createOrg();
    const email = correo();

    sendMail.mockRejectedValue(planVencido());
    const creado = await api('POST', '/api/superadmin/users', {
      token,
      body: { name: 'Admin ITCM', email, role: 'admin', organizationId: org.id },
    });
    const tokenViejo = (await prisma.user.findUnique({ where: { email } }))!.resetPasswordToken;

    sendMail.mockImplementation(async () => undefined);
    const res = await api('POST', `/api/superadmin/users/${creado.body.id}/resend-invitation`, { token });

    expect(res.status).toBe(200);
    expect(res.body.invitationSent).toBe(true);

    // El enlace se renueva: el de la invitación fallida ya no sirve, y el nuevo
    // trae su propio plazo de vencimiento contado desde ahora.
    const despues = await prisma.user.findUnique({ where: { email } });
    expect(despues!.resetPasswordToken).not.toBe(tokenViejo);
    expect(despues!.resetPasswordTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('no reenvía a una cuenta que ya está activada', async () => {
    const token = await superadminToken();
    const org = await createOrg();
    const ya = await createUser({ organizationId: org.id, role: UserRole.admin });
    await prisma.user.update({ where: { id: ya.id }, data: { emailVerified: true } });

    const res = await api('POST', `/api/superadmin/users/${ya.id}/resend-invitation`, { token });

    expect(res.status).toBe(409);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('informa si el reenvío también falla, en vez de fingir que salió', async () => {
    const token = await superadminToken();
    const org = await createOrg();
    const email = correo();

    sendMail.mockRejectedValue(planVencido());
    const creado = await api('POST', '/api/superadmin/users', {
      token,
      body: { name: 'Admin ITCM', email, role: 'admin', organizationId: org.id },
    });
    const res = await api('POST', `/api/superadmin/users/${creado.body.id}/resend-invitation`, { token });

    expect(res.status).toBe(200);
    expect(res.body.invitationSent).toBe(false);
  });
});

/**
 * El mismo agujero, una pantalla más abajo.
 *
 * Cuando un admin da de alta a un especialista pasaba exactamente lo mismo: el
 * envío era fire-and-forget, el panel afirmaba "Invitación enviada" sin mirar, y
 * no había forma de reenviar. Peor todavía: el correo del especialista queda
 * tomado, así que darlo de alta otra vez ni siquiera era una salida.
 */
describe('invitación de especialista', () => {
  /** El .env de desarrollo restringe el dominio; las pruebas lo respetan. */
  const correoEsp = () => `esp-${Date.now().toString(36)}-${++n}@mail.com`;

  async function adminDe(orgId: string) {
    const admin = await createUser({ organizationId: orgId, role: UserRole.admin });
    return tokenFor(admin);
  }

  async function altaEspecialista(token: string, email: string) {
    return api('POST', '/api/specialists', {
      token,
      body: { name: 'Dra. Ana López', department: 'Psicología', email, shift: 'Matutino' },
    });
  }

  it('el alta sobrevive al fallo del correo y lo reporta', async () => {
    const org = await createOrg();
    const token = await adminDe(org.id);
    const email = correoEsp();
    sendMail.mockRejectedValue(planVencido());

    const res = await altaEspecialista(token, email);

    expect(res.status).toBe(201);
    expect(res.body.invitationSent).toBe(false);
    expect(await prisma.specialist.findFirst({ where: { email } })).not.toBeNull();
  });

  it('cuando el correo sí sale, lo dice', async () => {
    const org = await createOrg();
    const token = await adminDe(org.id);

    const res = await altaEspecialista(token, correoEsp());

    expect(res.body.invitationSent).toBe(true);
  });

  it('la lista le marca al admin quién no ha activado', async () => {
    const org = await createOrg();
    const token = await adminDe(org.id);
    const email = correoEsp();
    await altaEspecialista(token, email);

    const res = await api('GET', '/api/specialists', { token });
    const creado = res.body.find((s: any) => s.email === email);

    expect(creado.pendingActivation).toBe(true);
  });

  it('al alumno NO se le dice el estado de la cuenta ajena', async () => {
    const org = await createOrg();
    const adminToken = await adminDe(org.id);
    const email = correoEsp();
    await altaEspecialista(adminToken, email);

    const alumno = await createUser({ organizationId: org.id, role: UserRole.alumno });
    const res = await api('GET', '/api/specialists', { token: tokenFor(alumno) });
    const visto = res.body.find((s: any) => s.email === email);

    expect(visto).toBeDefined();
    expect(visto).not.toHaveProperty('pendingActivation');
  });

  it('el admin puede reenviar, y el enlace se renueva', async () => {
    const org = await createOrg();
    const token = await adminDe(org.id);
    const email = correoEsp();

    sendMail.mockRejectedValue(planVencido());
    const creado = await altaEspecialista(token, email);
    const antes = (await prisma.user.findUnique({ where: { email } }))!.resetPasswordToken;

    sendMail.mockImplementation(async () => undefined);
    const res = await api('POST', `/api/specialists/${creado.body.id}/resend-invitation`, { token });

    expect(res.status).toBe(200);
    expect(res.body.invitationSent).toBe(true);
    const despues = await prisma.user.findUnique({ where: { email } });
    expect(despues!.resetPasswordToken).not.toBe(antes);
  });

  it('no reenvía a un especialista que ya activó su cuenta', async () => {
    const org = await createOrg();
    const token = await adminDe(org.id);
    const { specialist } = await createSpecialist({ organizationId: org.id });

    const res = await api('POST', `/api/specialists/${specialist.id}/resend-invitation`, { token });

    expect(res.status).toBe(409);
  });

  it('un admin no puede reenviar la invitación de otra organización', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const tokenA = await adminDe(orgA.id);
    const creado = await altaEspecialista(await adminDe(orgB.id), correoEsp());

    const res = await api('POST', `/api/specialists/${creado.body.id}/resend-invitation`, { token: tokenA });

    expect(res.status).toBe(404);
  });

  /**
   * La prueba que respalda el cambio de `emailVerified` a false al invitar.
   *
   * Si el login exigiera verificación a los especialistas, nacer sin activar los
   * dejaría fuera para siempre. No la exige (solo a alumno y usuario), y activar
   * la cuenta por el enlace la pone en true. Esto lo recorre de punta a punta.
   */
  it('el especialista invitado activa su cuenta y entra', async () => {
    const org = await createOrg();
    const token = await adminDe(org.id);
    const email = correoEsp();
    await altaEspecialista(token, email);

    const invitado = await prisma.user.findUnique({ where: { email } });
    expect(invitado!.emailVerified).toBe(false);

    const activacion = await api('POST', '/api/auth/reset-password', {
      body: { token: invitado!.resetPasswordToken, password: 'NuevaClave123' },
    });
    expect(activacion.status).toBe(200);

    const entrada = await api('POST', '/api/auth/login', {
      body: { email, password: 'NuevaClave123' },
    });
    expect(entrada.status).toBe(200);
    expect(entrada.body.token).toBeTruthy();

    const ya = await prisma.user.findUnique({ where: { email } });
    expect(ya!.emailVerified).toBe(true);
    expect(ya!.resetPasswordToken).toBeNull();
  });
});
