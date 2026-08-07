/**
 * Saneamiento de URLs que el usuario proporciona y la aplicación después
 * renderiza como `<a href>` en correos y en el frontend.
 *
 * Solo se acepta http(s): esquemas como `javascript:`, `data:` o `vbscript:`
 * convierten un enlace guardado en BD en XSS almacenado para quien lo abra.
 */

/** true si el texto es una URL absoluta con esquema http o https. */
export function isSafeHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export type UrlCheck =
  | { ok: true; value: string | null }
  | { ok: false };

/**
 * Normaliza un campo de URL opcional del body.
 *
 * - `undefined`            → `{ ok: true, value: null }` (el campo no se envió)
 * - cadena vacía o `"#"`   → `{ ok: true, value: null }` (equivale a "sin enlace")
 * - http(s) válida         → `{ ok: true, value: <url> }`
 * - cualquier otra cosa    → `{ ok: false }` para que el endpoint responda 400
 */
export function sanitizeOptionalHttpUrl(value: unknown): UrlCheck {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };

  const trimmed = value.trim();
  if (trimmed === '' || trimmed === '#') return { ok: true, value: null };

  return isSafeHttpUrl(trimmed) ? { ok: true, value: trimmed } : { ok: false };
}
