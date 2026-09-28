import { prepare } from '../database.js';
export function hasRun(ctx, job, periodKey) {
    return prepare(ctx.db, 'SELECT 1 FROM periodic_runs WHERE job = ? AND period_key = ?').get(job, periodKey) !== undefined;
}
/** Marks (job, periodKey) as done. Returns true if it was NOT done before (i.e. the caller should do the work). */
export function markRun(ctx, job, periodKey) {
    const r = prepare(ctx.db, 'INSERT OR IGNORE INTO periodic_runs (job, period_key, ran_at) VALUES (?, ?, ?)').run(job, periodKey, ctx.clock.now());
    return r.changes > 0;
}
//# sourceMappingURL=periodic.js.map