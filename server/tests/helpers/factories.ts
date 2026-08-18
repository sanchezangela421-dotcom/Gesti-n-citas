import bcrypt from 'bcryptjs';
import { UserRole } from '@prisma/client';
import { prisma } from '../../src/db';
import { SEED_DEPARTMENTS } from '../../src/lib/departments';

/**
 * Constructores de datos de prueba.
 *
 * Cada uno rellena lo imprescindible y admite sobrescrituras, para que cada test
 * declare solo lo que de verdad le importa y se lea como su propio enunciado.
 */

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${++seq}`;

export const TEST_PASSWORD = 'Test1234';

export async function createOrg(overrides: Partial<{ name: string; slug: string; type: string; active: boolean }> = {}) {
  const id = uniq();
  const org = await prisma.organization.create({
    data: {
      name: overrides.name ?? `Org ${id}`,
      slug: overrides.slug ?? `org-${id}`,
      type: overrides.type ?? 'school',
      active: overrides.active ?? true,
    },
  });

  // Igual que al crearla desde el panel: nace con su catálogo de departamentos.
  await prisma.orgDepartment.createMany({
    data: SEED_DEPARTMENTS.map(d => ({
      organizationId: org.id,
      name: d.name,
      color: d.color,
      icon: d.icon,
      requiresNote: d.requiresNote,
      order: d.order,
    })),
  });

  return org;
}

/**
 * Deja contratados exactamente esos departamentos.
 *
 * Los tests fijaban `Organization.departments` a mano; esa columna es ahora
 * derivada, así que hay que activar y desactivar las filas del catálogo, que es
 * lo que hace el panel. Mantiene la columna sincronizada para no dejar a
 * `/api/auth/me` devolviendo una lista desfasada.
 */
export async function setContractedDepartments(organizationId: string, names: string[]) {
  await prisma.orgDepartment.updateMany({
    where: { organizationId, name: { in: names } },
    data: { active: true },
  });
  await prisma.orgDepartment.updateMany({
    where: { organizationId, name: { notIn: names } },
    data: { active: false },
  });
  await prisma.organization.update({
    where: { id: organizationId },
    data: { departments: names },
  });
}

export async function createUser(opts: {
  organizationId?: string | null;
  role?: UserRole;
  email?: string;
  name?: string;
  emailVerified?: boolean;
  deletedAt?: Date | null;
  carrera?: string | null;
} = {}) {
  const id = uniq();
  return prisma.user.create({
    data: {
      email: opts.email ?? `user-${id}@test.local`,
      password: await bcrypt.hash(TEST_PASSWORD, 4), // coste bajo: las pruebas no miden fuerza del hash
      name: opts.name ?? `Usuario ${id}`,
      role: opts.role ?? UserRole.alumno,
      emailVerified: opts.emailVerified ?? true,
      organizationId: opts.organizationId ?? null,
      deletedAt: opts.deletedAt ?? null,
      carrera: opts.carrera ?? null,
    },
  });
}

/** Crea el par User(rol especialista) + Specialist, que siempre van juntos. */
export async function createSpecialist(opts: {
  organizationId?: string | null;
  department?: string;
  active?: boolean;
  deletedAt?: Date | null;
  name?: string;
} = {}) {
  const id = uniq();
  const department = opts.department ?? 'Psicología';
  const user = await createUser({
    organizationId: opts.organizationId,
    role: UserRole.especialista,
    name: opts.name ?? `Esp ${id}`,
  });
  const specialist = await prisma.specialist.create({
    data: {
      userId: user.id,
      name: user.name,
      department,
      email: user.email,
      active: opts.active ?? true,
      deletedAt: opts.deletedAt ?? null,
      organizationId: opts.organizationId ?? null,
    },
  });
  return { user, specialist };
}

export async function createAppointment(opts: {
  student: { id: string; name: string };
  specialist: { id: string; name: string; department: string };
  organizationId?: string | null;
  status?: string;
  date?: string;
  time?: string;
  modality?: string;
}) {
  return prisma.appointment.create({
    data: {
      studentId: opts.student.id,
      studentName: opts.student.name,
      specialistId: opts.specialist.id,
      specialistName: opts.specialist.name,
      department: opts.specialist.department,
      date: opts.date ?? isoDaysFromNow(7),
      time: opts.time ?? '10:00',
      status: opts.status ?? 'Confirmada',
      modality: opts.modality ?? 'Virtual',
      motivo: 'Motivo de prueba',
      organizationId: opts.organizationId ?? null,
    },
  });
}

export async function createClinicalNote(opts: {
  appointmentId: string;
  specialistId: string;
  studentId: string;
  department: string;
  organizationId?: string | null;
  body?: string;
}) {
  return prisma.clinicalNote.create({
    data: {
      appointmentId: opts.appointmentId,
      specialistId: opts.specialistId,
      studentId: opts.studentId,
      department: opts.department,
      organizationId: opts.organizationId ?? null,
      body: opts.body ?? 'Nota clínica de prueba.',
    },
  });
}

/** Fecha local "YYYY-MM-DD" desplazada N días; negativo para el pasado. */
export function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
