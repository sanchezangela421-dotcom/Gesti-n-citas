/**
 * Base URL del backend.
 *
 * Por defecto es vacía: el frontend llama a `/api` en su MISMO origen. En
 * producción nginx reenvía esas rutas al backend (docker-compose ya construye
 * con VITE_API_URL=""), y en desarrollo lo hace el proxy de Vite
 * (vite.config.ts). Solo hay que definir VITE_API_URL si el backend vive en
 * otro dominio (ver DEPLOYMENT.md).
 *
 * Antes caía a `http://localhost:3000`, que solo funciona en la máquina del
 * desarrollador: abierta desde otro dispositivo, ese localhost es el propio
 * dispositivo y ninguna petición llegaba al servidor.
 */
export const API_BASE: string =
  (import.meta as any).env?.VITE_API_URL ?? '';

export const API = `${API_BASE}/api`;

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) base['Authorization'] = `Bearer ${token}`;
  return base;
}

/** Solo devuelve el header Authorization, sin Content-Type.
 *  Úsalo en requests con FormData para que el browser ponga el boundary correcto. */
export function authOnlyHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// SuperAdmin usa token separado para aislamiento completo de sesión
export function superAdminHeaders(): Record<string, string> {
  const token = localStorage.getItem('sa_token');
  const base: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) base['Authorization'] = `Bearer ${token}`;
  return base;
}

/** Mensaje legible de un error capturado, con texto de respaldo si no lo trae. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Convierte una ruta relativa de upload (/uploads/...) a URL absoluta.
 * URLs externas (http/https) se devuelven tal cual.
 */
export function getImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('https://') || url.startsWith('http://')) return url;
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;
  return undefined;
}

/**
 * Construye una URL segura para archivos subidos al servidor.
 * Solo acepta rutas /uploads/...; codifica cada segmento con encodeURIComponent
 * para prevenir inyección de protocolos (javascript:, data:) en atributos src/href.
 */
export function getUploadUrl(path?: string | null): string | undefined {
  if (!path?.startsWith('/uploads/')) return undefined;
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  return `${API_BASE}${safePath}`;
}
