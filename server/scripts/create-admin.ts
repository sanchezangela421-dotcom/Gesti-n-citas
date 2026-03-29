/**
 * Script para crear un usuario administrador manualmente.
 * Uso: npx ts-node scripts/create-admin.ts <email> <password> [nombre]
 *
 * Ejemplo:
 *   npx ts-node scripts/create-admin.ts admin@nuevoleon.tecnm.mx MiPass123 "Admin TECNL"
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const [, , email, password, name = 'Administrador'] = process.argv;

  if (!email || !password) {
    console.error('\n❌  Faltan argumentos.');
    console.error('   Uso: npx ts-node scripts/create-admin.ts <email> <password> [nombre]\n');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`\n❌  El correo ${email} ya está registrado.\n`);
    process.exit(1);
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      role: 'admin',
      emailVerified: true,
    },
  });

  console.log(`\n✅  Administrador creado correctamente.`);
  console.log(`   Nombre : ${user.name}`);
  console.log(`   Correo : ${user.email}`);
  console.log(`   Rol    : ${user.role}\n`);
}

main()
  .catch((e) => {
    console.error('\n❌  Error al crear el administrador:', e.message, '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
