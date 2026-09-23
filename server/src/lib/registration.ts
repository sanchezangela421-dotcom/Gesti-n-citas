/**
 * Quién puede entrar a una organización.
 *
 * Hasta ahora esto lo decidía `ALLOWED_EMAIL_DOMAIN`, una sola variable del
 * proceso aplicada igual a toda la plataforma. Con una sola organización
 * funcionaba; con varias es imposible de configurar. Si se pone el dominio de
 * la escuela, el hospital no puede registrar a nadie; si se deja vacía,
 * cualquiera entra a la organización que elija del selector.
 *
 * El modelo que la reemplaza parte de un hecho del negocio: dentro de una misma
 * organización hay DOS poblaciones con situaciones distintas. El personal tiene
 * correo institucional; los usuarios finales no siempre. En una escuela el
 * alumno sí tiene dominio, pero el paciente de un hospital llega con el correo
 * que tenga, y exigirle `@hospital.mx` lo dejaría fuera.
 *
 * Por eso la organización declara su MODO, no solo sus dominios.
 */

export const REGISTRATION_MODES = ['open', 'domain', 'invitation'] as const;
export type RegistrationMode = (typeof REGISTRATION_MODES)[number];

export function isRegistrationMode(value: unknown): value is RegistrationMode {
  return typeof value === 'string' && (REGISTRATION_MODES as readonly string[]).includes(value);
}

/**
 * Modo con el que nace una organización, deducido de su giro.
 *
 * Es solo el punto de partida: el superadmin puede cambiarlo cuando quiera. Se
 * deduce para que el caso típico no pida configuración y, sobre todo, para que
 * una organización nueva no nazca abierta por omisión.
 *
 * - `school`   → `domain`: el correo institucional identifica al alumnado.
 * - `hospital` → `open`: el paciente llega de la calle, con el correo que tenga.
 * - resto      → `invitation`: sin saber más del giro, lo prudente es que el
 *   admin dé de alta a su gente en vez de dejar la puerta abierta.
 */
export function defaultRegistrationMode(type: string): RegistrationMode {
  if (type === 'school') return 'domain';
  if (type === 'hospital') return 'open';
  return 'invitation';
}

/** Dominio de un correo, en minúsculas. `null` si no parece un correo. */
export function emailDomain(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** Normaliza la lista que llega del panel: minúsculas, sin vacíos, sin repetidos. */
export function normalizeDomains(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return null;
    // Se acepta que lo escriban como "@dominio.mx" o "dominio.mx".
    const clean = item.trim().toLowerCase().replace(/^@/, '');
    if (!clean) continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return null;
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

export type RegistrationCheck =
  | { ok: true }
  | { ok: false; status: number; code: string; error: string };

interface RegistrationTarget {
  name: string;
  userRegistrationMode: string;
  allowedEmailDomains: string[];
}

/**
 * ¿Este correo puede autorregistrarse como usuario final de esta organización?
 *
 * Solo aplica al registro PÚBLICO. El alta de personal va por otro camino: ahí
 * hay un admin autenticado que ya decidió a quién está contratando, y su
 * criterio es la respuesta a quién pertenece a la organización.
 */
export function mayRegisterInOrganization(
  org: RegistrationTarget,
  email: string,
): RegistrationCheck {
  if (org.userRegistrationMode === 'open') return { ok: true };

  if (org.userRegistrationMode === 'invitation') {
    return {
      ok: false,
      status: 403,
      code: 'REGISTRATION_BY_INVITATION',
      error: `${org.name} no acepta registro público. Pide una invitación a su administrador.`,
    };
  }

  // modo `domain`
  const domain = emailDomain(email);
  // Una lista vacía en modo `domain` no deja pasar a nadie, y es lo correcto:
  // el modo dice "solo los de mi dominio" y todavía no se ha dicho cuál. Se
  // responde con un mensaje que explica qué falta, no con un rechazo mudo.
  if (org.allowedEmailDomains.length === 0) {
    return {
      ok: false,
      status: 403,
      code: 'ORG_DOMAINS_NOT_CONFIGURED',
      error: `${org.name} todavía no tiene configurados sus dominios de correo. Avisa a su administrador.`,
    };
  }
  if (!domain || !org.allowedEmailDomains.includes(domain)) {
    const lista = org.allowedEmailDomains.map(d => `@${d}`).join(', ');
    return {
      ok: false,
      status: 403,
      code: 'DOMAIN_NOT_ALLOWED',
      error: `Para registrarte en ${org.name} necesitas un correo ${lista}.`,
    };
  }
  return { ok: true };
}
