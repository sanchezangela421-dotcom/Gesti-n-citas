import { Prisma } from '@prisma/client';
import { prisma } from '../db';

/**
 * Catálogo de departamentos POR ORGANIZACIÓN (modelo `OrgDepartment`).
 *
 * Hasta agosto de 2026 los tres departamentos eran una constante de plataforma y
 * `Organization.departments` guardaba cuáles tenía contratados cada una. Ahora
 * cada departamento es una fila, y una organización puede definir los suyos.
 *
 * `Organization.departments` sigue existiendo y se mantiene sincronizado con los
 * nombres ACTIVOS: es lo que consume `/api/auth/me` y de ahí lo lee el frontend.
 * Es una columna derivada en transición — se eliminará cuando el frontend lea el
 * catálogo completo (mismo camino que siguió `ScheduleSlot.week`).
 */

/**
 * Los tres departamentos con los que nació la plataforma.
 *
 * Ya NO son el catálogo: son (a) lo que se siembra en una organización nueva y
 * (b) el respaldo para datos legacy sin organización, que son anteriores al
 * modelo multi-tenant y no deben quedarse sin servicio.
 */
export const ALL_DEPARTMENTS = ['Psicología', 'Tutorías', 'Nutrición'] as const;

/** Presentación y régimen de nota de los tres originales, al sembrarlos. */
export const SEED_DEPARTMENTS = [
  { name: 'Psicología', color: '#2563EB', icon: 'Brain',         requiresNote: true,  order: 1 },
  { name: 'Tutorías',   color: '#16A34A', icon: 'GraduationCap', requiresNote: false, order: 2 },
  { name: 'Nutrición',  color: '#EA580C', icon: 'Apple',         requiresNote: true,  order: 3 },
] as const;

/** Etiqueta usada por eventos y recursos que no pertenecen a un departamento. */
export const GENERAL_DEPARTMENT = 'General';

export interface DepartmentInput {
  name: string;
  color?: string;
  icon?: string;
  requiresNote?: boolean;
  order?: number;
}

/**
 * Normaliza y valida un nombre de departamento.
 *
 * El nombre es la clave real del sistema: viaja denormalizado en Appointment y
 * ClinicalNote, y sobre él se apoya la continuidad del expediente. Se recorta,
 * se colapsan espacios internos y se limita el largo, pero **no se cambian
 * acentos ni mayúsculas**: "Psicología" y "Psicologia" son departamentos
 * distintos a propósito, porque así viajan a las citas.
 */
export function normalizeDepartmentName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) return null;
  return name;
}

/** Departamentos de una organización, activos e inactivos, en orden. */
export async function listOrgDepartments(organizationId: string) {
  return prisma.orgDepartment.findMany({
    where: { organizationId },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Nombres de los departamentos CONTRATADOS (activos) de una organización.
 *
 * Los datos legacy sin organización conservan los tres originales: son
 * anteriores al modelo multi-tenant y quedarse sin servicio sería peor.
 * Una organización sin filas todavía (creada antes de la migración de datos)
 * también cae al respaldo, para no dejarla sin departamentos de golpe.
 */
export async function contractedDepartmentNames(
  organizationId: string | null | undefined,
): Promise<string[]> {
  if (!organizationId) return [...ALL_DEPARTMENTS];

  const rows = await prisma.orgDepartment.findMany({
    where: { organizationId, active: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { name: true },
  });

  if (rows.length === 0) {
    const any = await prisma.orgDepartment.count({ where: { organizationId } });
    // Con filas pero ninguna activa = decisión deliberada → lista vacía.
    if (any > 0) return [];

    // Sin catálogo todavía (organización anterior a la migración): se respeta lo
    // que decía su columna `departments`, que es lo que significaba "contratado"
    // antes. Devolver los tres aquí le regalaría departamentos que no tenía.
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { departments: true },
    });
    if (!org) return [];
    return org.departments.length > 0 ? org.departments : [...ALL_DEPARTMENTS];
  }

  return rows.map(r => r.name);
}

/**
 * ¿La organización tiene contratado ese departamento?
 *
 * Se comprueba en el servidor y no solo ocultando opciones en el selector: de lo
 * contrario bastaría una llamada directa a la API para operar en un departamento
 * no contratado.
 */
export async function isDepartmentContracted(
  organizationId: string | null | undefined,
  department: unknown,
): Promise<boolean> {
  if (typeof department !== 'string' || !department.trim()) return false;
  const names = await contractedDepartmentNames(organizationId);
  return names.includes(department);
}

/**
 * ¿Cerrar una cita en ese departamento obliga a dejar nota?
 *
 * Reemplaza a la lista fija `CLINICAL_DEPARTMENTS`: ahora es una propiedad de
 * cada departamento, porque una organización puede crear uno clínico o uno que
 * no lo sea. Un departamento sin fila (legacy) cae al criterio original:
 * Psicología y Nutrición son atención clínica, Tutorías no.
 */
export async function departmentRequiresNote(
  organizationId: string | null | undefined,
  department: string | null | undefined,
): Promise<boolean> {
  if (!department) return false;

  if (organizationId) {
    const row = await prisma.orgDepartment.findUnique({
      where: { organizationId_name: { organizationId, name: department } },
      select: { requiresNote: true },
    });
    if (row) return row.requiresNote;
  }

  return SEED_DEPARTMENTS.some(d => d.name === department && d.requiresNote);
}

/**
 * Sincroniza `Organization.departments` con los nombres activos.
 *
 * La columna es derivada y en transición; se actualiza en la misma transacción
 * que la mutación del catálogo para que `/api/auth/me` nunca devuelva una lista
 * desfasada al frontend.
 */
export async function syncOrgDepartmentNames(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string[]> {
  const rows = await tx.orgDepartment.findMany({
    where: { organizationId, active: true },
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    select: { name: true },
  });
  const names = rows.map(r => r.name);
  await tx.organization.update({
    where: { id: organizationId },
    data: { departments: names },
  });
  return names;
}

/**
 * Un departamento solo puede renombrarse mientras no tenga citas.
 *
 * El nombre viaja denormalizado a Appointment y ClinicalNote: renombrarlo
 * después desconectaría al paciente de su propio historial. Se comprueba también
 * contra los especialistas, que quedarían apuntando a un departamento inexistente.
 */
export async function departmentIsRenameable(
  organizationId: string,
  name: string,
): Promise<boolean> {
  const [appointments, specialists] = await Promise.all([
    prisma.appointment.count({ where: { organizationId, department: name } }),
    prisma.specialist.count({ where: { organizationId, department: name } }),
  ]);
  return appointments === 0 && specialists === 0;
}
