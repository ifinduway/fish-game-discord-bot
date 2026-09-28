// Server-wide counters (scope 'all' & 'w:<weekKey>'). Metrics: catches, total_weight, bosses_defeated, casts.
import { weekKey } from '../../core/time.js';
import { prepare } from '../database.js';
import { SCOPE_ALL, scopeWeek } from './stats.js';
export function serverDefaultScopes(ctx) {
    return [SCOPE_ALL, scopeWeek(weekKey(ctx.clock.now(), ctx.config.timezone))];
}
export function incServerStat(ctx, metric, delta, scopes = serverDefaultScopes(ctx)) {
    const stmt = prepare(ctx.db, 'INSERT INTO server_stats (scope, metric, value) VALUES (?, ?, ?) ON CONFLICT(scope, metric) DO UPDATE SET value = value + excluded.value');
    for (const s of scopes)
        stmt.run(s, metric, delta);
}
export function getServerStat(ctx, metric, scope = SCOPE_ALL) {
    const r = prepare(ctx.db, 'SELECT value FROM server_stats WHERE scope = ? AND metric = ?').get(scope, metric);
    return r?.value ?? 0;
}
export function getAllServerStats(ctx, scope = SCOPE_ALL) {
    const rows = prepare(ctx.db, 'SELECT metric, value FROM server_stats WHERE scope = ?').all(scope);
    return Object.fromEntries(rows.map((r) => [r.metric, r.value]));
}
//# sourceMappingURL=server-stats.js.map