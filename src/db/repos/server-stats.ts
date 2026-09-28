// Server-wide counters (scope 'all' & 'w:<weekKey>'). Metrics: catches, total_weight, bosses_defeated, casts.
import { weekKey } from '../../core/time.js';
import { prepare, type DbCtx } from '../database.js';
import { SCOPE_ALL, scopeWeek, type ScopeCtx } from './stats.js';

export function serverDefaultScopes(ctx: ScopeCtx): string[] {
  return [SCOPE_ALL, scopeWeek(weekKey(ctx.clock.now(), ctx.config.timezone))];
}

export function incServerStat(ctx: ScopeCtx, metric: string, delta: number, scopes: string[] = serverDefaultScopes(ctx)): void {
  const stmt = prepare(
    ctx.db,
    'INSERT INTO server_stats (scope, metric, value) VALUES (?, ?, ?) ON CONFLICT(scope, metric) DO UPDATE SET value = value + excluded.value',
  );
  for (const s of scopes) stmt.run(s, metric, delta);
}

export function getServerStat(ctx: DbCtx, metric: string, scope: string = SCOPE_ALL): number {
  const r = prepare(ctx.db, 'SELECT value FROM server_stats WHERE scope = ? AND metric = ?').get(scope, metric) as { value: number } | undefined;
  return r?.value ?? 0;
}

export function getAllServerStats(ctx: DbCtx, scope: string = SCOPE_ALL): Record<string, number> {
  const rows = prepare(ctx.db, 'SELECT metric, value FROM server_stats WHERE scope = ?').all(scope) as { metric: string; value: number }[];
  return Object.fromEntries(rows.map((r) => [r.metric, r.value]));
}
