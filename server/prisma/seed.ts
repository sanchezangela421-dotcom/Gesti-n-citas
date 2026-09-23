import { PrismaClient, UserRole, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SEED_DEPARTMENTS } from '../src/lib/departments';

const prisma = new PrismaClient();
const HASH_ROUNDS = 10;

/**
 * Este script crea cuentas con una contraseña conocida, incluida una de
 * superadmin que no pertenece a ninguna organización y por tanto alcanza los
 * datos de TODOS los inquilinos. Por eso lleva los mismos dos seguros que
 * `src/scripts/cleanup.ts`: se niega a correr en producción y no trae ninguna
 * contraseña por defecto.
 *
 * El segundo seguro importa tanto como el primero, porque este script puede
 * apuntarse a cualquier base con solo cambiar DATABASE_URL.
 *
 * Ojo con el hook: `package.json` registra este archivo como `prisma.seed`, pero
 * `prisma.config.ts` sobrescribe esa propiedad y NO declara seed, así que hoy
 * `prisma migrate dev` no lo dispara solo. Si alguna vez se añade la entrada de
 * seed a `prisma.config.ts`, ese disparo automático vuelve — y estos dos seguros
 * son lo único que lo separaría de una base real.
 */
if (process.env.NODE_ENV === 'production') {
  console.error('⛔ Este script NO puede ejecutarse en producción: siembra cuentas con contraseña conocida.');
  process.exit(1);
}

const DEFAULT_PASS = process.env.SEED_PASSWORD;
if (!DEFAULT_PASS) {
  console.error('⛔ Falta SEED_PASSWORD. Defínela antes de sembrar, p. ej.:');
  console.error('   Genera una con:  node -e "console.log(require(`crypto`).randomBytes(12).toString(`base64url`))"');
  process.exit(1);
}

async function main() {
  console.log('🌱 Seeding database...');

  const hashedPass = await bcrypt.hash(DEFAULT_PASS, HASH_ROUNDS);

  // ── 1. Organization ──────────────────────────────────────────────────────────
  const org = await prisma.organization.upsert({
    where: { slug: 'tecnl' },
    update: { userRoleLabel: 'Alumno', userRegistrationMode: 'domain', allowedEmailDomains: ['mail.com'] },
    create: {
      id: 'org-tecnl-001',
      name: 'TECNL',
      slug: 'tecnl',
      type: 'school',
      plan: 'free',
      active: true,
      userRoleLabel: 'Alumno',
      // Es una escuela, así que el correo institucional identifica al alumnado.
      // En desarrollo el "dominio institucional" es el de las cuentas sembradas,
      // para que el registro se pueda probar sin configurar nada más.
      userRegistrationMode: 'domain',
      allowedEmailDomains: ['mail.com'],
    },
  });

  // Catálogo de departamentos de la organización. Es upsert para poder volver a
  // sembrar sin pisar los colores o el régimen de nota que alguien haya ajustado.
  for (const dept of SEED_DEPARTMENTS) {
    await prisma.orgDepartment.upsert({
      where: { organizationId_name: { organizationId: org.id, name: dept.name } },
      update: {},
      create: {
        organizationId: org.id,
        name: dept.name,
        color: dept.color,
        icon: dept.icon,
        requiresNote: dept.requiresNote,
        order: dept.order,
      },
    });
  }
  console.log(`✔ Organization: ${org.name} (${org.id})`);

  // ── 2. Registration fields para TECNL ────────────────────────────────────────
  const CAREERS = [
    'Ingeniería en Sistemas Computacionales',
    'Ingeniería Industrial',
    'Ingeniería Electrónica',
    'Ingeniería Mecatrónica',
    'Ingeniería Eléctrica',
    'Ingeniería Civil',
    'Ingeniería Bioquímica',
    'Ingeniería Química',
    'Licenciatura en Administración',
    'Arquitectura',
  ];

  const tecnlFields: Array<{
    key: string; label: string; type: string; required: boolean; order: number;
    options: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    placeholder: string | null;
  }> = [
    { key: 'carrera',         label: 'Carrera',             type: 'select', required: true,  order: 1, options: CAREERS,                  placeholder: null },
    { key: 'matricula',       label: 'Número de Control',   type: 'text',   required: false, order: 2, options: Prisma.JsonNull,           placeholder: 'Ej. 20210001' },
    { key: 'semestre',        label: 'Semestre',            type: 'number', required: false, order: 3, options: Prisma.JsonNull,           placeholder: 'Ej. 5' },
    { key: 'fechaNacimiento', label: 'Fecha de Nacimiento', type: 'date',   required: false, order: 4, options: Prisma.JsonNull,           placeholder: null },
    { key: 'genero',          label: 'Género',              type: 'radio',  required: true,  order: 5, options: ['Masculino', 'Femenino'], placeholder: null },
  ];

  for (const field of tecnlFields) {
    await prisma.registrationField.upsert({
      where: { organizationId_key: { organizationId: org.id, key: field.key } },
      update: { label: field.label, required: field.required, order: field.order, options: field.options, placeholder: field.placeholder },
      create: { organizationId: org.id, ...field },
    });
  }
  console.log(`✔ Registration fields: ${tecnlFields.length} campos para TECNL`);

  // ── 3. SuperAdmin (sin org — alcance de plataforma) ──────────────────────────
  const superadmin = await prisma.user.upsert({
    where: { email: 'superadmin@gestioncitas.app' },
    update: {},
    create: {
      email: 'superadmin@gestioncitas.app',
      password: hashedPass,
      name: 'Super Admin',
      role: UserRole.superadmin,
      emailVerified: true,
      organizationId: null,
    },
  });
  console.log(`✔ SuperAdmin: ${superadmin.email}`);

  // ── 3. Admin TECNL ───────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: 'admin@mail.com' },
    update: {},
    create: {
      email: 'admin@mail.com',
      password: hashedPass,
      name: 'Admin TECNL',
      role: UserRole.admin,
      emailVerified: true,
      organizationId: org.id,
    },
  });
  console.log(`✔ Admin: ${admin.email}`);

  // ── 4. Especialista ──────────────────────────────────────────────────────────
  const specialistUser = await prisma.user.upsert({
    where: { email: 'especialista@mail.com' },
    update: {},
    create: {
      email: 'especialista@mail.com',
      password: hashedPass,
      name: 'Dr. Juan Pérez',
      role: UserRole.especialista,
      emailVerified: true,
      department: 'Psicología',
      organizationId: org.id,
    },
  });

  await prisma.specialist.upsert({
    where: { userId: specialistUser.id },
    update: {},
    create: {
      userId: specialistUser.id,
      name: specialistUser.name,
      department: 'Psicología',
      email: specialistUser.email,
      active: true,
      shift: 'Matutino',
      organizationId: org.id,
    },
  });
  console.log(`✔ Especialista: ${specialistUser.email}`);

  // ── 5. Alumno ────────────────────────────────────────────────────────────────
  const student = await prisma.user.upsert({
    where: { email: 'alumno@mail.com' },
    update: {},
    create: {
      email: 'alumno@mail.com',
      password: hashedPass,
      name: 'Ana García',
      role: UserRole.alumno,
      emailVerified: true,
      matricula: 'L20123456',
      carrera: 'Ingeniería en Sistemas',
      semestre: 5,
      organizationId: org.id,
    },
  });
  console.log(`✔ Alumno: ${student.email}`);

  // Se listan las cuentas pero NO la contraseña: ya la eligió quien corre el
  // script, y repetirla aquí la deja en el historial de la terminal y en los
  // registros de CI.
  console.log('\n✅ Seed completado. Cuentas sembradas (contraseña: la de SEED_PASSWORD):');
  console.log('──────────────────────────────────────────────');
  console.log('  superadmin@gestioncitas.app');
  console.log('  admin@mail.com');
  console.log('  especialista@mail.com');
  console.log('  alumno@mail.com');
  console.log('──────────────────────────────────────────────');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
