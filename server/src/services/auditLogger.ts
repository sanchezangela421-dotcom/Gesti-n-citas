import { prisma } from '../db';

interface AuditEntry {
  actorId: string;
  actorRole: string;
  action: string;
  targetEntity: string;
  targetId: string;
  organizationId?: string | null;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Escribe en la bitácora SIN esperar. Para acciones de volumen, donde perder una
 * entrada aislada no cambia nada y no se quiere pagar el viaje a la base.
 *
 * Para eventos de autenticación úsese `writeAuditNow`: ahí sí importa que la
 * entrada quede escrita, y son pocos.
 */
/**
 * Identidad del error, sin su contenido.
 *
 * NUNCA se registra el error completo de un fallo al escribir la bitácora: los
 * errores de validación de Prisma incluyen en su mensaje los ARGUMENTOS de la
 * consulta, y aquí esos argumentos son la propia entrada de auditoría. Para los
 * eventos de cuenta eso significa el correo de una persona, así que un fallo de
 * la bitácora acabaría volcando datos personales al log del servidor.
 *
 * El código (`P2002`) o el nombre de la clase basta para saber qué pasó; el
 * detalle del registro perdido está en la propia petición que lo originó.
 */
function errorTag(err: unknown): string {
  const e = err as { name?: string; code?: string };
  return e?.code ?? e?.name ?? 'error desconocido';
}

export function writeAudit(entry: AuditEntry): void {
  prisma.auditLog.create({ data: entry }).catch(err => {
    console.error('[AuditLog] No se pudo guardar una entrada:', errorTag(err));
  });
}

/**
 * Escribe en la bitácora y ESPERA a que quede guardada.
 *
 * Se usa en los eventos de autenticación (accesos, altas, recuperación de
 * contraseña) por dos motivos: son de volumen bajo, y con la escritura al vuelo
 * un reinicio del proceso justo después de responder podía llevarse el registro
 * — precisamente el que interesa conservar.
 *
 * NO propaga el error a propósito: un fallo al escribir la bitácora no debe
 * impedir que alguien entre a la plataforma. Queda en el log del servidor, que
 * es donde se ve si la auditoría dejó de funcionar. (La postura estricta sería
 * rechazar el acceso cuando no se puede auditar; se descartó porque un error en
 * la auditoría dejaría fuera a toda la organización.)
 */
export async function writeAuditNow(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: entry });
  } catch (err) {
    // Tampoco se escribe `entry.action`. El analisis de seguridad lo marca como
    // dato sensible por llamarse PASSWORD_RESET_*, y aunque solo sea el nombre
    // del evento, la diferencia diagnostica es minima: un fallo al escribir la
    // bitacora es casi siempre sistemico (base caida, esquema desfasado), no de
    // un evento concreto, y para eso el codigo de error dice mas que el nombre.
    console.error('[AuditLog] No se pudo guardar un evento de seguridad:', errorTag(err));
  }
}

/**
 * Lo mínimo que hace falta de una petición para poder registrarla.
 *
 * Se declara estructuralmente en vez de depender del `Request` de Express para
 * que estas funciones se puedan probar con un objeto simple, sin montar el
 * servidor entero.
 */
export interface AuditableRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}

export function getClientIp(req: AuditableRequest): string {
  // req.ip respeta 'trust proxy' (app.ts): detrás de nginx es la IP real del
  // cliente y no puede falsificarse con un header X-Forwarded-For arbitrario.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** Tope del User-Agent guardado. El header lo controla quien llama. */
const MAX_USER_AGENT = 512;

/**
 * Navegador/cliente de la petición.
 *
 * Se recorta porque el valor viene de un header que el cliente elige libremente:
 * sin tope, una petición podría escribir kilobytes por fila en la bitácora, que
 * es una forma barata de inflar la tabla.
 */
export function getClientUserAgent(req: AuditableRequest): string | undefined {
  const raw = req.headers?.['user-agent'];
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  return raw.slice(0, MAX_USER_AGENT);
}

/** IP + navegador de una petición, que es como se registran siempre juntos. */
export function requestContext(req: AuditableRequest) {
  return { ipAddress: getClientIp(req), userAgent: getClientUserAgent(req) };
}

/** Tope de un valor de texto llegado del cliente antes de guardarlo en metadata. */
const MAX_METADATA_TEXT = 320;

/**
 * Prepara un dato del cliente para guardarlo en `metadata`.
 *
 * El caso típico es el correo de un intento fallido: hay que conservarlo (es lo
 * que distingue un tanteo masivo de un ataque a una cuenta concreta), pero llega
 * sin validar y podría no ser ni una cadena.
 */
export function auditText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_METADATA_TEXT);
}

/**
 * Acciones de autenticación.
 *
 * Viven aquí como constantes y no sueltas por las rutas porque el panel del
 * superadmin filtra por este valor exacto: una errata no da error de
 * compilación, simplemente deja el evento fuera de cualquier búsqueda.
 */
export const AUTH_ACTION = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  REGISTER_SUCCESS: 'REGISTER_SUCCESS',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  PASSWORD_RESET_FAILED: 'PASSWORD_RESET_FAILED',
} as const;

/**
 * Por qué se rechazó un acceso.
 *
 * La respuesta HTTP es deliberadamente vaga ("Credenciales inválidas") para no
 * revelar si un correo existe. La bitácora sí guarda el motivo real: es lo que
 * separa "alguien probando correos al azar" de "alguien insistiendo sobre una
 * cuenta concreta", que son incidentes distintos.
 */
export const LOGIN_FAILURE = {
  USER_NOT_FOUND: 'user_not_found',
  WRONG_PASSWORD: 'wrong_password',
  SUPERADMIN_VIA_USER_LOGIN: 'superadmin_via_user_login',
  ACCOUNT_DEACTIVATED: 'account_deactivated',
  ORG_SUSPENDED: 'org_suspended',
  EMAIL_NOT_VERIFIED: 'email_not_verified',
} as const;

/**
 * Acciones del superadmin que NO cambian nada: consultas.
 *
 * Se registran porque son la única forensia disponible si esa cuenta se ve
 * comprometida. El superadmin puede leer los datos de todas las organizaciones,
 * así que un atacante con su sesión no necesita modificar nada para hacer daño:
 * le basta con mirar. Sin esto, ese paseo no deja rastro.
 *
 * Se registra QUÉ listado se consultó, con qué filtro y cuántas filas devolvió
 * —no las filas en sí—: lo que interesa reconstruir es el alcance de lo que vio,
 * y copiar los datos a la bitácora los duplicaría en otra tabla.
 *
 * Deliberadamente NO se audita la consulta de la propia bitácora: sería ruido
 * que crece solo y entierra justo lo que se viene a buscar.
 */
export const SUPERADMIN_ACTION = {
  USERS_VIEWED: 'SUPERADMIN_USERS_VIEWED',
  ORGS_VIEWED: 'SUPERADMIN_ORGS_VIEWED',
} as const;

/** Actor de un evento cuyo autor no se pudo identificar (correo inexistente). */
export const UNKNOWN_ACTOR = 'unknown';
