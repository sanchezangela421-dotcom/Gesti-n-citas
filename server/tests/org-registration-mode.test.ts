import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api, tokenFor } from './helpers/api';
import { createOrg, createUser } from './helpers/factories';

/**
 * Quién puede entrar a cada organización.
 *
 * Antes lo decidía `ALLOWED_EMAIL_DOMAIN`, una sola variable del proceso
 * aplicada igual a toda la plataforma. Con una organización funcionaba; con
 * varias no hay valor correcto: si se pone el dominio de la escuela, el
 * hospital no puede registrar a nadie, y si se deja vacía, cualquiera entra a
 * la organización que elija del selector público.
 *
 * El modelo que la reemplaza parte de un hecho del negocio: dentro de una misma
 * organización el personal tiene correo institucional, pero los usuarios finales
 * no siempre. El paciente de un hospital llega con el correo que tenga, y
 * exigirle el dominio de la institución lo dejaría fuera. Por eso la
 * organización declara su MODO, no solo sus dominios.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

async function orgConModo(
  userRegistrationMode: string,
  allowedEmailDomains: string[] = [],
  type = 'school',
) {
  const org = await createOrg({ type });
  return prisma.organization.update({
    where: { id: org.id },
    data: { userRegistrationMode, allowedEmailDomains },
  });
}

const alta = (organizationId: string | undefined, email: string) => ({
  email,
  password: 'Test1234',
  name: 'Persona Nueva',
  ...(organizationId === undefined ? {} : { organizationId }),
});

describe('modo open: el hospital que acepta pacientes de la calle', () => {
  it('acepta cualquier dominio', async () => {
    const org = await orgConModo('open', [], 'hospital');

    const res = await api('POST', '/api/auth/register', {
      body: alta(org.id, 'paciente@gmail.com'),
    });

    expect(res.status).toBe(201);
    const creado = await prisma.user.findUnique({ where: { email: 'paciente@gmail.com' } });
    expect(creado?.organizationId).toBe(org.id);
    // Hospital, así que el rol es `usuario`, no `alumno`
    expect(creado?.role).toBe(UserRole.usuario);
  });
});

describe('modo domain: la escuela donde el correo identifica', () => {
  it('acepta un correo del dominio configurado', async () => {
    const org = await orgConModo('domain', ['nuevoleon.tecnm.mx']);

    const res = await api('POST', '/api/auth/register', {
      body: alta(org.id, 'alumna@nuevoleon.tecnm.mx'),
    });

    expect(res.status).toBe(201);
  });

  it('rechaza un correo de otro dominio y dice cuál hace falta', async () => {
    const org = await orgConModo('domain', ['nuevoleon.tecnm.mx']);

    const res = await api('POST', '/api/auth/register', {
      body: alta(org.id, 'cualquiera@gmail.com'),
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DOMAIN_NOT_ALLOWED');
    expect(res.body.error).toContain('@nuevoleon.tecnm.mx');
    expect(await prisma.user.count({ where: { email: 'cualquiera@gmail.com' } })).toBe(0);
  });

  it('sin dominios configurados no deja pasar a nadie, y lo explica', async () => {
    const org = await orgConModo('domain', []);

    const res = await api('POST', '/api/auth/register', {
      body: alta(org.id, 'quien.sea@gmail.com'),
    });

    // Es un estado legítimo mientras se configura, pero por fuera se ve igual
    // que "no funciona": el mensaje tiene que decir qué falta.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORG_DOMAINS_NOT_CONFIGURED');
  });

  it('acepta varios dominios, no solo uno', async () => {
    const org = await orgConModo('domain', ['alumnos.mx', 'docentes.mx']);

    for (const email of ['a@alumnos.mx', 'b@docentes.mx']) {
      const res = await api('POST', '/api/auth/register', { body: alta(org.id, email) });
      expect(res.status).toBe(201);
    }
  });
});

describe('modo invitation: solo entra quien el admin da de alta', () => {
  it('rechaza el registro público', async () => {
    const org = await orgConModo('invitation', [], 'company');

    const res = await api('POST', '/api/auth/register', {
      body: alta(org.id, 'externo@gmail.com'),
    });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REGISTRATION_BY_INVITATION');
  });
});

describe('la organización es obligatoria', () => {
  it('omitirla ya no deja la cuenta en el grupo sin inquilino', async () => {
    const res = await api('POST', '/api/auth/register', {
      body: alta(undefined, 'sin.organizacion@gmail.com'),
    });

    // Antes esto creaba la cuenta con organizationId null. Ese grupo no es un
    // limbo: `orgScope` lo trata como un filtro concreto, así que la cuenta veía
    // las filas heredadas sin organización. Y mientras se pudiera omitir, la
    // regla de pertenencia se saltaba con no mandar el campo.
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ORGANIZATION_REQUIRED');
    expect(await prisma.user.count({ where: { email: 'sin.organizacion@gmail.com' } })).toBe(0);
  });

  it('una organización inactiva tampoco admite registros', async () => {
    const org = await createOrg({ active: false });

    const res = await api('POST', '/api/auth/register', {
      body: alta(org.id, 'tarde@gmail.com'),
    });

    expect(res.status).toBe(400);
  });
});

describe('una organización nueva nace con el modo de su giro', () => {
  async function crearComoSuperadmin(type: string, slug: string) {
    const sa = await createUser({ organizationId: null, role: UserRole.superadmin });
    const res = await api('POST', '/api/superadmin/organizations', {
      token: tokenFor(sa),
      body: { name: `Org ${slug}`, slug, type },
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  it.each([
    ['school', 'domain'],
    ['hospital', 'open'],
    ['company', 'invitation'],
  ])('una organización de tipo %s nace en modo %s', async (type, modo) => {
    const org = await crearComoSuperadmin(type, `nueva-${type}`);
    expect(org.userRegistrationMode).toBe(modo);
  });

  it('la escuela nace sin dominios, así que su registro queda cerrado hasta configurarla', async () => {
    const org = await crearComoSuperadmin('school', 'escuela-sin-dominios');
    expect(org.allowedEmailDomains).toEqual([]);

    const res = await api('POST', '/api/auth/register', {
      body: alta(org.id, 'alguien@gmail.com'),
    });
    expect(res.body.code).toBe('ORG_DOMAINS_NOT_CONFIGURED');
  });
});

describe('el superadmin cambia el modo y los dominios', () => {
  async function patch(orgId: string, body: object) {
    const sa = await createUser({ organizationId: null, role: UserRole.superadmin });
    return api('PATCH', `/api/superadmin/organizations/${orgId}`, { token: tokenFor(sa), body });
  }

  it('cambia el modo', async () => {
    const org = await orgConModo('invitation');
    const res = await patch(org.id, { userRegistrationMode: 'open' });

    expect(res.status).toBe(200);
    expect(res.body.userRegistrationMode).toBe('open');
  });

  it('normaliza los dominios que llegan del panel', async () => {
    const org = await orgConModo('domain');
    const res = await patch(org.id, {
      allowedEmailDomains: ['  @NuevoLeon.TecNM.mx ', 'nuevoleon.tecnm.mx', '', 'otro.mx'],
    });

    expect(res.status).toBe(200);
    // Minúsculas, sin la arroba, sin vacíos y sin repetidos
    expect(res.body.allowedEmailDomains).toEqual(['nuevoleon.tecnm.mx', 'otro.mx']);
  });

  it('rechaza un modo que no existe', async () => {
    const org = await orgConModo('open');
    const res = await patch(org.id, { userRegistrationMode: 'barra-libre' });
    expect(res.status).toBe(400);
  });

  it('rechaza una lista de dominios que no lo es', async () => {
    const org = await orgConModo('domain');
    const res = await patch(org.id, { allowedEmailDomains: ['no es un dominio'] });
    expect(res.status).toBe(400);
  });

  it('avisa cuando el cambio deja el registro cerrado sin querer', async () => {
    const org = await orgConModo('open');
    const res = await patch(org.id, { userRegistrationMode: 'domain' });

    expect(res.status).toBe(200);
    // Modo `domain` sin dominios: legítimo, pero conviene que quien lo dejó así
    // lo sepa, porque por fuera se ve igual que una aplicación rota.
    expect(res.body.registroCerradoPorFaltaDeDominios).toBe(true);
  });
});

describe('el alta de personal va por otro camino', () => {
  async function adminDe(org: { id: string }) {
    const admin = await createUser({ organizationId: org.id, role: UserRole.admin });
    return tokenFor(admin);
  }

  it('el modo de registro no le aplica: en una organización por invitación el admin sigue dando de alta', async () => {
    const org = await orgConModo('invitation');

    const res = await api('POST', '/api/specialists', {
      token: await adminDe(org),
      body: { name: 'Psicóloga', email: 'psicologa@gmail.com', department: 'Psicología' },
    });

    // Aquí hay un admin autenticado que ya decidió a quién contrata: su criterio
    // es la respuesta a quién pertenece a la organización.
    expect(res.status).toBe(201);
  });

  it('pero si la organización declaró dominios, el personal debe usarlos', async () => {
    const org = await orgConModo('domain', ['nuevoleon.tecnm.mx']);

    const rechazado = await api('POST', '/api/specialists', {
      token: await adminDe(org),
      body: { name: 'Psicóloga', email: 'psicologa@gmail.com', department: 'Psicología' },
    });
    expect(rechazado.status).toBe(400);
    expect(rechazado.body.code).toBe('DOMAIN_NOT_ALLOWED');

    const aceptado = await api('POST', '/api/specialists', {
      token: await adminDe(org),
      body: { name: 'Psicóloga', email: 'psicologa@nuevoleon.tecnm.mx', department: 'Psicología' },
    });
    expect(aceptado.status).toBe(201);
  });
});

describe('el formulario público sabe qué esperar', () => {
  it('la lista de organizaciones trae el modo y los dominios', async () => {
    const escuela = await orgConModo('domain', ['nuevoleon.tecnm.mx']);
    await orgConModo('invitation', [], 'company');

    const res = await api('GET', '/api/public/organizations');

    expect(res.status).toBe(200);
    const encontrada = res.body.find((o: any) => o.id === escuela.id);
    // Sin esto, la persona llena el formulario entero para llevarse un rechazo
    // al final. Ninguno de los dos datos es secreto.
    expect(encontrada.userRegistrationMode).toBe('domain');
    expect(encontrada.allowedEmailDomains).toEqual(['nuevoleon.tecnm.mx']);
  });
});
