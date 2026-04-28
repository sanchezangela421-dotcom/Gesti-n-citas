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

/**
 * Convierte una ruta relativa de upload (/uploads/...) a URL absoluta.
 * URLs externas (http/https) se devuelven tal cual.
 */
export function getImageUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/uploads/')) return `${API_BASE}${url}`;
  return url;
}
