import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db';
import { createOrg } from './helpers/factories';
import { backfillOrgFields } from '../src/scripts/backfillOrgFields';

/**
 * Backfill de campos de registro.
 *
 * Las organizaciones creadas antes de agosto de 2026 nacieron SIN campos, así
 * que su formulario de registro no pedía nada y sus gráficas demográficas
 * quedaban vacías. El script las siembra, pero tiene que ser inofensivo: si pisa
 * una organización ya configurada, borra trabajo hecho a mano.
 */

/** Silencia la salida del script durante las pruebas. */
const quiet = () => { /* no-op */ };

describe('backfill de campos de registro', () => {
  it('siembra los campos de una organización que no tiene ninguno', async () => {
    const org = await createOrg({ type: 'school' });

    await backfillOrgFields({ log: quiet });

    const fields = await prisma.registrationField.findMany({
      where: { organizationId: org.id },
    });
    const keys = fields.map(f => f.key);
    expect(keys).toContain('fechanacimiento');
    expect(keys).toContain('genero');
    expect(keys).toContain('matricula');
  });

  it('respeta el tipo de organización', async () => {
    const empresa = await createOrg({ type: 'company' });

    await backfillOrgFields({ log: quiet });

    const keys = (await prisma.registrationField.findMany({
      where: { organizationId: empresa.id },
    })).map(f => f.key);
    expect(keys).toContain('numero_empleado');
    expect(keys).not.toContain('matricula');
  });

  it('NO toca una organización que ya tiene campos configurados', async () => {
    const org = await createOrg({ type: 'school' });
    await prisma.registrationField.create({
      data: {
        organizationId: org.id, key: 'solo_este', label: 'Campo a mano',
        type: 'text', required: false, order: 0,
      },
    });

    await backfillOrgFields({ log: quiet });

    const fields = await prisma.registrationField.findMany({
      where: { organizationId: org.id },
    });
    // Sigue teniendo exactamente el suyo: el script no le añadió los de por defecto.
    expect(fields).toHaveLength(1);
    expect(fields[0].key).toBe('solo_este');
  });

  it('es idempotente: correrlo dos veces no duplica nada', async () => {
    const org = await createOrg({ type: 'hospital' });

    await backfillOrgFields({ log: quiet });
    const after1 = await prisma.registrationField.count({ where: { organizationId: org.id } });

    const result = await backfillOrgFields({ log: quiet });
    const after2 = await prisma.registrationField.count({ where: { organizationId: org.id } });

    expect(after2).toBe(after1);
    expect(result.updated).not.toContain(org.id);
  });

  it('en dry-run no escribe nada', async () => {
    const org = await createOrg({ type: 'school' });

    const result = await backfillOrgFields({ dryRun: true, log: quiet });

    expect(result.updated).toEqual([]);
    const count = await prisma.registrationField.count({ where: { organizationId: org.id } });
    expect(count).toBe(0);
  });
});
