/**
 * Base URL del backend. Se toma de la variable de entorno VITE_API_URL si está
 * definida (producción), o cae a localhost:3000 en desarrollo.
 */
export const API_BASE: string =
  (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:3000';

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
