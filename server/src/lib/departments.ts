import { prisma } from '../db';

/**
 * Catálogo de departamentos de la plataforma.
 *
 * Es FIJO por decisión de producto: los tres departamentos son el servicio que
 * ofrece Synkros, y las organizaciones no crean los suyos. Lo que sí varía es
 * cuáles tiene contratados cada una (`Organization.departments`).
 *
 * Por eso vive aquí como constante y no como tabla: no hay nada que modelar
 * relacionalmente, y mantenerlo así evita migrar el campo `department` de
 * Appointment y ClinicalNote, que es lo que sostiene la regla de continuidad
 * del expediente.
 */
export const ALL_DEPARTMENTS = ['Psicología', 'Tutorías', 'Nutrición'] as const;

export type Department = (typeof ALL_DEPARTMENTS)[number];

export function isKnownDepartment(value: unknown): value is Department {
  return typeof value === 'string' && (ALL_DEPARTMENTS as readonly string[]).includes(value);
}

/**
 * Normaliza la lista de departamentos contratados que llega del cliente:
 * descarta lo que no esté en el catálogo y elimina duplicados.
 * Devuelve null si algún valor no es un departamento válido.
 */
export function parseContractedDepartments(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some(v => !isKnownDepartment(v))) return null;
  return [...new Set(value as string[])];
}

/**
 * Departamentos activos de una organización.
 *
 * Los datos legacy sin organización (organizationId null) conservan los tres:
 * son de antes del modelo multi-tenant y no deben quedarse sin servicio.
 */
export function contractedDepartments(org?: { departments?: string[] } | null): string[] {
  if (!org || !Array.isArray(org.departments) || org.departments.length === 0) {
    return [...ALL_DEPARTMENTS];
  }
  return org.departments;
}

/**
 * Departamentos cuya atención es clínica y por tanto exige nota de sesión.
 *
 * Tutorías queda fuera a propósito: es acompañamiento académico, no un servicio
 * de salud, así que la NOM-004 no le aplica y exigirle una "nota clínica" no
 * tendría fundamento. Ahí la anotación existe igual, pero es opcional y se llama
 * "Observaciones".
 */
export const CLINICAL_DEPARTMENTS: readonly string[] = ['Psicología', 'Nutrición'];

/** ¿Cerrar una cita de este departamento obliga a dejar nota? */
export function requiresClinicalNote(department: string | null | undefined): boolean {
  return !!department && CLINICAL_DEPARTMENTS.includes(department);
}

/** Etiqueta usada por eventos y recursos que no pertenecen a un departamento. */
export const GENERAL_DEPARTMENT = 'General';

/**
 * ¿La organización tiene contratado ese departamento?
 *
 * Se comprueba en el servidor y no solo ocultando opciones en el selector:
 * de lo contrario bastaría una llamada directa a la API para operar en un
 * departamento no contratado.
 */
export async function isDepartmentContracted(
  organizationId: string | null | undefined,
  department: unknown,
): Promise<boolean> {
  if (!isKnownDepartment(department)) return false;
  // Datos legacy sin organización: conservan los tres departamentos
  if (!organizationId) return true;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { departments: true },
  });
  return contractedDepartments(org).includes(department);
}
