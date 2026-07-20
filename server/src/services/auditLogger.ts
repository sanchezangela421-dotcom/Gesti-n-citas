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
}

export function writeAudit(entry: AuditEntry): void {
  prisma.auditLog.create({ data: entry }).catch(err => {
    console.error('[AuditLog] Failed to write entry:', err);
  });
}

export function getClientIp(req: { ip?: string; socket?: any }): string {
  // req.ip respeta 'trust proxy' (index.ts): detrás de nginx es la IP real del
  // cliente y no puede falsificarse con un header X-Forwarded-For arbitrario.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
