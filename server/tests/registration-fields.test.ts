import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/db';
import { startTestServer, stopTestServer, api } from './helpers/api';
import { createOrg } from './helpers/factories';
import { metadataValue, normalizeFieldKey, legacyOrMetadata, defaultFieldsForOrgType } from '../src/lib/registrationFields';

/**
 * Campos de registro por organización.
 *
 * El fallo que motivó estas pruebas: el panel guarda la clave normalizada
 * (`fechaNacimiento` → `fechanacimiento`) pero el volcado a las columnas legacy
 * la buscaba en camelCase. Nunca coincidía, así que toda organización creada
 * desde el panel se quedaba sin fecha de nacimiento ni género y sus gráficas
 * demográficas salían vacías. Se veía "bien" solo en TECNL, sembrada por script
 * saltándose la API.
 */

beforeAll(async () => { await startTestServer(); });
afterAll(async () => { await stopTestServer(); });

describe('normalización de claves', () => {
  it('la forma guardada es minúsculas con guiones bajos', () => {
    expect(normalizeFieldKey('  Fecha Nacimiento ')).toBe('fecha_nacimiento');
    expect(normalizeFieldKey('fechaNacimiento')).toBe('fechanacimiento');
  });

  it('encuentra el valor sin importar cómo se haya escrito la clave', () => {
    const variantes = ['fechaNacimiento', 'fechanacimiento', 'fecha_nacimiento', 'Fecha Nacimiento'];
    for (const key of variantes) {
      expect(metadataValue({ [key]: '2003-03-15' }, 'fechaNacimiento')).toBe('2003-03-15');
    }
  });

  it('acepta las variantes con preposición y sin acento', () => {
    expect(metadataValue({ 'fecha_de_nacimiento': '2001-01-02' }, 'fechaNacimiento')).toBe('2001-01-02');
    expect(metadataValue({ 'Género': 'Femenino' }, 'genero')).toBe('Femenino');
    expect(metadataValue({ 'numero_de_control': 'A1' }, 'matricula')).toBe('A1');
  });

  it('no confunde un campo con otro', () => {
    expect(metadataValue({ carrera: 'ISC' }, 'fechaNacimiento')).toBeUndefined();
    expect(metadataValue({}, 'genero')).toBeUndefined();
    expect(metadataValue(null, 'genero')).toBeUndefined();
  });

  it('la columna legacy gana sobre metadata, y metadata rescata si viene vacía', () => {
    expect(legacyOrMetadata({ carrera: 'Directo', metadata: { carrera: 'Dinámico' } }, 'carrera')).toBe('Directo');
    expect(legacyOrMetadata({ carrera: null, metadata: { Carrera: 'Dinámico' } }, 'carrera')).toBe('Dinámico');
    expect(legacyOrMetadata({ carrera: null, metadata: null }, 'carrera')).toBeUndefined();
  });
});

describe('registro de usuario', () => {
  it('llena la columna legacy aunque la clave se haya guardado normalizada', async () => {
    const org = await createOrg({ type: 'school' });
    const email = `demog-${Date.now()}@test.local`;

    // Tal cual lo manda el formulario cuando el panel normalizó la clave.
    const res = await api('POST', '/api/auth/register', {
      body: {
        name: 'Persona de prueba',
        email,
        password: 'Test1234',
        organizationId: org.id,
        metadata: { fechanacimiento: '2004-05-06', genero: 'Femenino', matricula: '20210001' },
      },
    });

    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.fechaNacimiento).toBe('2004-05-06');
    expect(user!.genero).toBe('Femenino');
    expect(user!.matricula).toBe('20210001');
  });

  it('sigue funcionando con las claves camelCase que siembra el seed', async () => {
    const org = await createOrg({ type: 'school' });
    const email = `demog-camel-${Date.now()}@test.local`;

    const res = await api('POST', '/api/auth/register', {
      body: {
        name: 'Persona de prueba',
        email,
        password: 'Test1234',
        organizationId: org.id,
        metadata: { fechaNacimiento: '1999-12-31', genero: 'Masculino', semestre: '7' },
      },
    });

    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.fechaNacimiento).toBe('1999-12-31');
    expect(user!.genero).toBe('Masculino');
    expect(user!.semestre).toBe(7);
  });

  it('un semestre no numérico no rompe el registro: queda en null', async () => {
    const org = await createOrg({ type: 'school' });
    const email = `demog-sem-${Date.now()}@test.local`;

    const res = await api('POST', '/api/auth/register', {
      body: {
        name: 'Persona de prueba',
        email,
        password: 'Test1234',
        organizationId: org.id,
        metadata: { semestre: 'séptimo' },
      },
    });

    expect(res.status).toBe(201);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user!.semestre).toBeNull();
  });
});

describe('campos por defecto de una organización nueva', () => {
  it('una escuela nace pidiendo fecha de nacimiento, género y matrícula', async () => {
    const org = await createOrg({ type: 'school' });

    // createOrg escribe directo en la base (como el seed), así que aquí se
    // comprueba el helper que alimenta al endpoint del panel.
    const keys = defaultFieldsForOrgType(org.type).map(f => f.key);

    expect(keys).toContain('fechanacimiento');
    expect(keys).toContain('genero');
    expect(keys).toContain('matricula');
  });

  it('un hospital y una empresa no piden matrícula, pero sí los demográficos', async () => {

    for (const [type, identifier] of [['hospital', 'expediente'], ['company', 'numero_empleado']] as const) {
      const keys = defaultFieldsForOrgType(type).map(f => f.key);
      expect(keys).toContain('fechanacimiento');
      expect(keys).toContain('genero');
      expect(keys).toContain(identifier);
      expect(keys).not.toContain('matricula');
    }
  });

  it('los campos por defecto son legibles por el formulario público', async () => {
    const org = await createOrg({ type: 'company' });
    await prisma.registrationField.createMany({
      data: defaultFieldsForOrgType(org.type).map(f => ({
        organizationId: org.id,
        key: f.key, label: f.label, type: f.type,
        required: f.required, order: f.order,
        options: f.options ?? undefined,
        placeholder: f.placeholder,
      })),
    });

    const res = await api('GET', `/api/public/organizations/${org.slug}/fields`);

    expect(res.status).toBe(200);
    const keys = res.body.registrationFields.map((f: { key: string }) => f.key);
    expect(keys).toContain('fechanacimiento');
    expect(keys).toContain('genero');
  });
});
