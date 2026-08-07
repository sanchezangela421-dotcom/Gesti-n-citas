import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/db';

/**
 * Cada test arranca con la base vacía.
 *
 * Se trunca con CASCADE en una sola sentencia porque las FKs de retención son
 * RESTRICT: borrar tabla por tabla fallaría, y el orden correcto sería frágil de
 * mantener conforme crezca el esquema. TRUNCATE evita además tener que resolver
 * dependencias a mano.
 *
 * `_prisma_migrations` se excluye: si se vaciara, cada archivo de test volvería a
 * aplicar todas las migraciones.
 */
async function truncateAll() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;

  const list = tables.map(t => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});
