import type { Clock } from '../../core/clock.js';
import { prepare, type DbCtx } from '../database.js';

export interface AuditRow {
  id: number;
  at: number;
  actor_id: string;
  action: string;
  details: string | null;
}

/** Appends an audit entry; non-string details are JSON-encoded. Returns the row id. */
export function addAudit(ctx: DbCtx & { clock: Clock }, actorId: string, action: string, details?: unknown): number {
  const text = details === undefined ? null : typeof details === 'string' ? details : JSON.stringify(details);
  const r = prepare(ctx.db, 'INSERT INTO audit_log (at, actor_id, action, details) VALUES (?, ?, ?, ?)').run(ctx.clock.now(), actorId, action, text);
  return Number(r.lastInsertRowid);
}

export function listAudit(ctx: DbCtx, limit = 50): AuditRow[] {
  return prepare(ctx.db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as AuditRow[];
}
