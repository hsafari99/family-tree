import type { AuditAction, AuditEntity } from '@family-tree/shared';
import type { Queryable } from '../db/client.js';
import { auditLog } from '../db/schema.js';

export interface AuditActor {
  treeId: string;
  userId: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  entityType: AuditEntity;
  entityId: string | null;
  /** The people this change concerns; they see it in their History. */
  personIds?: readonly string[];
  before?: unknown;
  after?: unknown;
}

/** Records one change (spec §8). Always call it inside the transaction that makes the change. */
export async function audit(db: Queryable, actor: AuditActor, e: AuditEntry): Promise<void> {
  // member/steward/invite rows must never reach a person's History (decision 13).
  if (/^(member|steward|invite)\./.test(e.action) && (e.personIds?.length ?? 0) > 0) {
    throw new Error(`audit: ${e.action} must not set personIds`);
  }
  await db.insert(auditLog).values({
    treeId: actor.treeId,
    userId: actor.userId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    personIds: [...new Set(e.personIds ?? [])],
    before: e.before ?? null,
    after: e.after ?? null,
  });
}

/** JSON with object keys sorted, so jsonb values (which Postgres reorders) compare equal. */
export function stable(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, x]) => x !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
}

/** The fields of `keys` that differ, as { before, after } with only those fields; null if none. */
export function changedFields<K extends string>(
  before: Partial<Record<K, unknown>>,
  after: Partial<Record<K, unknown>>,
  keys: readonly K[],
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of keys) {
    if (stable(before[k] ?? null) !== stable(after[k] ?? null)) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return Object.keys(a).length > 0 ? { before: b, after: a } : null;
}
