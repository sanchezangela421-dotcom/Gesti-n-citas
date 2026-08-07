import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

/**
 * Las pruebas corren contra un Postgres REAL, no contra mocks.
 *
 * Buena parte de lo que hay que garantizar vive en la base de datos —las FKs
 * Restrict que protegen el expediente clínico— y un Prisma simulado las daría
 * por buenas sin comprobar nada.
 *
 * La BD de pruebas se deriva de DATABASE_URL añadiendo el sufijo `_test`, salvo
 * que se indique TEST_DATABASE_URL. Nunca se toca la base de desarrollo: las
 * pruebas truncan tablas entre casos.
 */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('Falta DATABASE_URL (o TEST_DATABASE_URL) para ejecutar las pruebas.');
  }

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '') || 'postgres';
  if (dbName.endsWith('_test')) return base; // ya apunta a una BD de pruebas
  url.pathname = `/${dbName}_test`;
  return url.toString();
}

const DATABASE_URL = testDatabaseUrl();

// Se asigna aquí, y no solo en `test.env`, porque globalSetup se ejecuta en el
// proceso principal de Vitest: `test.env` solo alcanza a los workers, y sin esto
// la preparación de la BD apuntaría a la base de desarrollo.
process.env.DATABASE_URL = DATABASE_URL;
process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Una sola BD compartida: en paralelo los tests se pisarían al truncar.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL,
      // Secreto fijo y propio de las pruebas: no depende del .env del desarrollador
      JWT_SECRET: 'test-jwt-secret-not-used-anywhere-else',
      // Sin restricción de dominio ni de IP, para no acoplar los tests al entorno
      ALLOWED_EMAIL_DOMAIN: '',
      SUPERADMIN_ALLOWED_IPS: '',
      FRONTEND_URL: 'http://localhost:5173',
      BACKEND_URL: 'http://localhost:3000',
    },
  },
});
