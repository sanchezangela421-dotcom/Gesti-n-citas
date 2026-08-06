import type { Server } from 'http';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';

/**
 * Monta la app en un puerto efímero y devuelve un cliente HTTP mínimo.
 *
 * Se usa el `fetch` global de Node en lugar de supertest: hace lo mismo para
 * pruebas de API y evita una dependencia más en el árbol del servidor.
 */
let server: Server | null = null;
let baseUrl = '';

export async function startTestServer(): Promise<string> {
  if (server) return baseUrl;
  const app = createApp();
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve()); // 0 = el SO asigna un puerto libre
  });
  const addr = server!.address();
  if (!addr || typeof addr === 'string') throw new Error('No se pudo obtener el puerto de pruebas');
  baseUrl = `http://127.0.0.1:${addr.port}`;
  return baseUrl;
}

export async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) =>
    server!.close(err => (err ? reject(err) : resolve()))
  );
  server = null;
  baseUrl = '';
}

export interface ApiResponse<T = any> {
  status: number;
  body: T;
}

/** Petición autenticada (o anónima si `token` es null) contra la API de pruebas. */
export async function api<T = any>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  opts: { token?: string | null; body?: unknown } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  // Algunas respuestas (204, errores de proxy) no traen JSON
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }

  return { status: res.status, body };
}

/**
 * Espera a que una condición se cumpla, sondeando hasta agotar el plazo.
 *
 * Varios efectos del servidor son fire-and-forget a propósito (avisos por
 * correo, notificaciones, auditoría): la respuesta HTTP no espera a que
 * terminen. Dormir un tiempo fijo hace la prueba intermitente — pasa en una
 * máquina rápida y falla bajo carga, que es peor que no tenerla.
 */
export async function waitFor<T>(
  probe: () => Promise<T | null | undefined | false>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const { timeoutMs = 10_000, intervalMs = 50, label = 'la condición esperada' } = opts;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const result = await probe();
    if (result) return result as T;
    if (Date.now() >= deadline) {
      throw new Error(`Tiempo agotado (${timeoutMs} ms) esperando ${label}.`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/**
 * Firma un JWT como lo haría el login. Evita tener que pasar por /auth/login en
 * cada test, que además exige contraseñas y verificación de correo.
 */
export function tokenFor(user: {
  id: string;
  email: string;
  role: string;
  organizationId?: string | null;
  tokenVersion?: number;
}): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId ?? null,
      tokenVersion: user.tokenVersion ?? 0,
    },
    process.env.JWT_SECRET!,
    { expiresIn: '1h', algorithm: 'HS256' },
  );
}
