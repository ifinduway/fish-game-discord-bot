import { prepare } from '../database.js';
/** Appends an audit entry; non-string details are JSON-encoded. Returns the row id. */
export function addAudit(ctx, actorId, action, details) {
    const text = details === undefined ? null : typeof details === 'string' ? details : JSON.stringify(details);
    const r = prepare(ctx.db, 'INSERT INTO audit_log (at, actor_id, action, details) VALUES (?, ?, ?, ?)').run(ctx.clock.now(), actorId, action, text);
    return Number(r.lastInsertRowid);
}
export function listAudit(ctx, limit = 50) {
    return prepare(ctx.db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
}
//# sourceMappingURL=audit.js.map