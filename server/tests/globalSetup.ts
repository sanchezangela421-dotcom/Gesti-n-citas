import { execSync } from 'child_process';

/**
 * Prepara la base de datos de pruebas una sola vez por ejecución.
 *
 * `prisma migrate deploy` crea la base si no existe y le aplica las migraciones.
 * Se usa `migrate deploy` y no `db push` a propósito: así las pruebas ejercen
 * exactamente las mismas migraciones que se aplicarán en producción, incluidas
 * las restricciones que protegen el expediente clínico.
 */
export default async function globalSetup() {
  const testUrl = process.env.DATABASE_URL;
  if (!testUrl) throw new Error('DATABASE_URL no está definida para las pruebas.');

  const dbName = new URL(testUrl).pathname.replace(/^\//, '');

  // Salvaguarda: sin esto, un DATABASE_URL mal configurado haría que la suite
  // truncara la base de datos de desarrollo entre cada test.
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `La BD de pruebas debe terminar en "_test" (recibido: "${dbName}"). ` +
      'Revisa TEST_DATABASE_URL para no borrar datos de desarrollo.'
    );
  }

  // `pnpm exec` y no `npx`: npx puede intentar descargar el paquete de la red si
  // no lo resuelve en local, lo que en CI convierte un fallo de resolución en una
  // descarga silenciosa. El proyecto declara pnpm en `packageManager`.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
