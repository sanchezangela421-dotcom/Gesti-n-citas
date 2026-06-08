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

export function getClientIp(req: { headers: any; socket: any }): string {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}
