import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db';
import { createOrg } from './helpers/factories';

/**
 * Modelo OrgDepartment: catálogo de departamentos por organización.
 *
 * El NOMBRE es la clave real: viaja denormalizado en Appointment, ClinicalNote,
 * Specialist, AppEvent y Resource, y sobre él se apoya la continuidad del
 * expediente. Dos departamentos con el mismo nombre en una organización harían
 * ambiguo a cuál pertenece una nota, así que la unicidad no es cosmética.
 *
 * Toda organización nace con los tres originales sembrados (igual que al
 * crearla desde el panel), así que las pruebas parten de ese estado.
 */

async function addDept(organizationId: string, name: string, extra: Record<string, unknown> = {}) {
  return prisma.orgDepartment.create({ data: { organizationId, name, ...extra } });
}

describe('catálogo inicial', () => {
  it('una organización nueva nace con los tres originales', async () => {
    const org = await createOrg();

    const rows = await prisma.orgDepartment.findMany({
      where: { organizationId: org.id },
      orderBy: { order: 'asc' },
    });

    expect(rows.map(d => d.name)).toEqual(['Psicología', 'Tutorías', 'Nutrición']);
    expect(rows.every(d => d.active)).toBe(true);
  });

  it('el régimen de nota viene del catálogo, no de una lista fija', async () => {
    const org = await createOrg();
    const rows = await prisma.orgDepartment.findMany({ where: { organizationId: org.id } });
    const requiere = Object.fromEntries(rows.map(d => [d.name, d.requiresNote]));

    // Psicología y Nutrición son atención clínica (NOM-004); Tutorías no.
    expect(requiere['Psicología']).toBe(true);
    expect(requiere['Nutrición']).toBe(true);
    expect(requiere['Tutorías']).toBe(false);
  });
});

describe('unicidad del nombre', () => {
  it('una organización no puede tener dos departamentos con el mismo nombre', async () => {
    const org = await createOrg();
    await addDept(org.id, 'Trabajo Social');

    await expect(addDept(org.id, 'Trabajo Social')).rejects.toThrow();
  });

  it('tampoco puede repetir uno de los que ya trae sembrados', async () => {
    const org = await createOrg();

    await expect(addDept(org.id, 'Psicología')).rejects.toThrow();
  });

  it('dos organizaciones SÍ pueden llamar igual a su departamento', async () => {
    const a = await createOrg();
    const b = await createOrg();

    await addDept(a.id, 'Trabajo Social');
    await addDept(b.id, 'Trabajo Social');

    const total = await prisma.orgDepartment.count({ where: { name: 'Trabajo Social' } });
    expect(total).toBe(2);
  });

  it('el nombre distingue acentos: son departamentos distintos', async () => {
    const org = await createOrg(); // ya trae "Psicología"

    // No es un descuido: el nombre viaja como texto exacto a las citas, así que
    // "Psicologia" sin acento ES otro departamento. La UI debe evitar el tropiezo.
    await expect(addDept(org.id, 'Psicologia')).resolves.toBeTruthy();
  });
});

describe('valores por defecto de uno nuevo', () => {
  it('nace activo, sin nota obligatoria y con presentación genérica', async () => {
    const org = await createOrg();
    const dept = await addDept(org.id, 'Trabajo Social');

    expect(dept.active).toBe(true);
    expect(dept.requiresNote).toBe(false);
    expect(dept.color).toBe('#64748b');
    // Nombre de icono lucide, nunca un componente: el backend no sabe de JSX.
    expect(dept.icon).toBe('Stethoscope');
    expect(dept.order).toBe(0);
  });

  it('acepta marcarlo como clínico y desactivarlo', async () => {
    const org = await createOrg();
    const dept = await addDept(org.id, 'Psiquiatría', {
      requiresNote: true, active: false, color: '#7c3aed', icon: 'Brain', order: 5,
    });

    expect(dept.requiresNote).toBe(true);
    expect(dept.active).toBe(false);
    expect(dept.color).toBe('#7c3aed');
  });
});

describe('aislamiento por organización', () => {
  it('los departamentos propios de una organización no se ven desde otra', async () => {
    const a = await createOrg();
    const b = await createOrg();
    await addDept(a.id, 'Trabajo Social');

    const propiosDeA = await prisma.orgDepartment.findMany({
      where: { organizationId: a.id, name: 'Trabajo Social' },
    });
    const propiosDeB = await prisma.orgDepartment.findMany({
      where: { organizationId: b.id, name: 'Trabajo Social' },
    });

    expect(propiosDeA).toHaveLength(1);
    expect(propiosDeB).toHaveLength(0);
  });
});
