// Idempotency helper for scheduler jobs (table periodic_runs).
import type { Clock } from '../../core/clock.js';
import { prepare, type DbCtx } from '../database.js';

export function hasRun(ctx: DbCtx, job: string, periodKey: string): boolean {
  return prepare(ctx.db, 'SELECT 1 FROM periodic_runs WHERE job = ? AND period_key = ?').get(job, periodKey) !== undefined;
}

/** Marks (job, periodKey) as done. Returns true if it was NOT done before (i.e. the caller should do the work). */
export function markRun(ctx: DbCtx & { clock: Clock }, job: string, periodKey: string): boolean {
  const r = prepare(ctx.db, 'INSERT OR IGNORE INTO periodic_runs (job, period_key, ran_at) VALUES (?, ?, ?)').run(job, periodKey, ctx.clock.now());
  return r.changes > 0;
}
