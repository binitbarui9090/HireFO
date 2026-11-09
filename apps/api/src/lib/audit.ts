import type { AuditAction } from '@hirefo/shared';
import { logger } from '../config/logger.js';
import { prisma, type Db } from '../db/prisma.js';

export interface AuditInput {
  action: AuditAction | string;
  organizationId?: string | null;
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Appends an audit row. Auditing must never break the request it describes, so
 * failures are logged and swallowed — except inside a transaction, where the
 * caller passes `db` and the write participates in that transaction.
 */
export async function recordAudit(input: AuditInput, db: Db = prisma): Promise<void> {
  const data = {
    action: input.action,
    organizationId: input.organizationId ?? null,
    actorId: input.actorId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: (input.metadata ?? {}) as object,
    ip: input.ip ?? null,
    userAgent: input.userAgent?.slice(0, 500) ?? null,
  };
  try {
    await db.auditEvent.create({ data });
  } catch (err) {
    logger.error({ err, action: input.action }, 'failed to write audit event');
    if (db !== prisma) throw err;
  }
  logger.info(
    {
      audit: true,
      action: data.action,
      organizationId: data.organizationId,
      actorId: data.actorId,
      targetType: data.targetType,
      targetId: data.targetId,
    },
    'audit',
  );
}
