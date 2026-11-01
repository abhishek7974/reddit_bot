import type { Db } from './db.ts';
import { Prisma } from './db.ts';

export interface AuditInput {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  policyVersion?: string | null;
  metadata?: unknown;
}

type Tx = Pick<Db, 'auditEvent'>;

/** Append-only audit trail. Never include tokens or raw Reddit content in metadata. */
export async function audit(db: Tx, e: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      reason: e.reason ?? null,
      policyVersion: e.policyVersion ?? null,
      metadata: e.metadata === undefined ? Prisma.JsonNull : (e.metadata as Prisma.InputJsonValue),
    },
  });
}
