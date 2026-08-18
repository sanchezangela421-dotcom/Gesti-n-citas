import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { MISSED } from '../src/routes/appointments';

/**
 * Contrato de las constantes que viven duplicadas entre servidor y navegador.
 *
 * El estado de la cita viaja como TEXTO por la API, así que si un lado le quita
 * un acento no falla nada: simplemente deja de coincidir, la cita desaparece de
 * los listados y nadie se entera. TypeScript no puede vigilarlo porque son dos
 * proyectos independientes sin paquete compartido.
 *
 * Esta prueba lee el archivo de constantes del frontend y compara el valor. Es
 * tosca a propósito: la solución de fondo (workspace de pnpm con un paquete
 * común) todavía no se justifica para dos constantes.
 */

const FRONTEND_CONSTANTS = path.resolve(__dirname, '../../project_final/src/constants/index.ts');

/** Lee `export const <name> = "<valor>";` del archivo de constantes del frontend. */
function frontendConstant(source: string, name: string): string | null {
  const match = source.match(new RegExp(`export const ${name}\\s*=\\s*["'\`]([^"'\`]+)["'\`]`));
  return match ? match[1] : null;
}

describe('constantes compartidas con el frontend', () => {
  it('el archivo de constantes del frontend es accesible', () => {
    // Si esto falla, la prueba no puede vigilar nada: es preferible que grite a
    // que se salte en silencio y deje la deriva sin guardia.
    expect(
      fs.existsSync(FRONTEND_CONSTANTS),
      `No se encontró ${FRONTEND_CONSTANTS}. Esta prueba necesita el repo completo (backend + frontend).`,
    ).toBe(true);
  });

  it('MISSED_STATUS del frontend coincide con MISSED del servidor', () => {
    const source = fs.readFileSync(FRONTEND_CONSTANTS, 'utf8');
    const fromFrontend = frontendConstant(source, 'MISSED_STATUS');

    expect(
      fromFrontend,
      'No se pudo leer MISSED_STATUS en el archivo de constantes del frontend.',
    ).not.toBeNull();

    expect(
      fromFrontend,
      `El estado de inasistencia difiere: servidor "${MISSED}" vs frontend "${fromFrontend}". ` +
      'Viaja como texto por la API, así que si no coinciden la cita deja de aparecer en los listados.',
    ).toBe(MISSED);
  });
});
