import { prepare } from '../database.js';
export class InsufficientItemsError extends Error {
    itemId;
    required;
    available;
    constructor(itemId, required, available) {
        super(`Insufficient item ${itemId}: need ${required}, have ${available}`);
        this.itemId = itemId;
        this.required = required;
        this.available = available;
        this.name = 'InsufficientItemsError';
    }
}
function assertQty(qty) {
    if (!Number.isInteger(qty) || qty < 0)
        throw new Error(`Invalid quantity: ${qty}`);
}
export function listConsumables(ctx, userId) {
    return prepare(ctx.db, 'SELECT item_id, qty FROM consumables WHERE user_id = ? AND qty > 0 ORDER BY item_id').all(userId);
}
export function getConsumableQty(ctx, userId, itemId) {
    const r = prepare(ctx.db, 'SELECT qty FROM consumables WHERE user_id = ? AND item_id = ?').get(userId, itemId);
    return r?.qty ?? 0;
}
/** Returns the new quantity. */
export function addConsumable(ctx, userId, itemId, qty) {
    assertQty(qty);
    prepare(ctx.db, 'INSERT INTO consumables (user_id, item_id, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty').run(userId, itemId, qty);
    return getConsumableQty(ctx, userId, itemId);
}
/** Returns the new quantity; throws InsufficientItemsError (nothing changed) if not enough. */
export function removeConsumable(ctx, userId, itemId, qty) {
    assertQty(qty);
    const r = prepare(ctx.db, 'UPDATE consumables SET qty = qty - ? WHERE user_id = ? AND item_id = ? AND qty >= ?').run(qty, userId, itemId, qty);
    if (r.changes === 0)
        throw new InsufficientItemsError(itemId, qty, getConsumableQty(ctx, userId, itemId));
    prepare(ctx.db, 'DELETE FROM consumables WHERE user_id = ? AND item_id = ? AND qty = 0').run(userId, itemId);
    return getConsumableQty(ctx, userId, itemId);
}
export function getActiveBait(ctx, userId) {
    return prepare(ctx.db, 'SELECT item_id, casts_left FROM active_bait WHERE user_id = ?').get(userId);
}
export function setActiveBait(ctx, userId, itemId, castsLeft) {
    prepare(ctx.db, 'INSERT INTO active_bait (user_id, item_id, casts_left) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET item_id = excluded.item_id, casts_left = excluded.casts_left').run(userId, itemId, castsLeft);
}
export function clearActiveBait(ctx, userId) {
    prepare(ctx.db, 'DELETE FROM active_bait WHERE user_id = ?').run(userId);
}
/** Returns the new gear_items.id. */
export function addGearItem(ctx, userId, gearId, acquiredAt, upgrade = 0) {
    const r = prepare(ctx.db, 'INSERT INTO gear_items (user_id, gear_id, upgrade, acquired_at) VALUES (?, ?, ?, ?)').run(userId, gearId, upgrade, acquiredAt);
    return Number(r.lastInsertRowid);
}
export function listGearItems(ctx, userId) {
    return prepare(ctx.db, 'SELECT * FROM gear_items WHERE user_id = ? ORDER BY id').all(userId);
}
export function getGearItem(ctx, gearItemId) {
    return prepare(ctx.db, 'SELECT * FROM gear_items WHERE id = ?').get(gearItemId);
}
/** true if the user owns at least one gear item with this catalog id. */
export function hasGear(ctx, userId, gearId) {
    return prepare(ctx.db, 'SELECT 1 FROM gear_items WHERE user_id = ? AND gear_id = ? LIMIT 1').get(userId, gearId) !== undefined;
}
export function setGearUpgrade(ctx, gearItemId, upgrade) {
    prepare(ctx.db, 'UPDATE gear_items SET upgrade = ? WHERE id = ?').run(upgrade, gearItemId);
}
/** Deletes a gear item (and unequips it first). */
export function deleteGearItem(ctx, gearItemId) {
    prepare(ctx.db, 'DELETE FROM equipped WHERE gear_item_id = ?').run(gearItemId);
    prepare(ctx.db, 'DELETE FROM gear_items WHERE id = ?').run(gearItemId);
}
// ───────────────────────── equipped ─────────────────────────
/** slot → gear_items.id */
export function getEquipped(ctx, userId) {
    const rows = prepare(ctx.db, 'SELECT slot, gear_item_id FROM equipped WHERE user_id = ?').all(userId);
    const out = {};
    for (const r of rows)
        out[r.slot] = r.gear_item_id;
    return out;
}
/** slot → full gear item row */
export function getEquippedItems(ctx, userId) {
    const rows = prepare(ctx.db, 'SELECT e.slot AS slot, g.* FROM equipped e JOIN gear_items g ON g.id = e.gear_item_id WHERE e.user_id = ?').all(userId);
    const out = {};
    for (const { slot, ...item } of rows)
        out[slot] = item;
    return out;
}
/** Caller must validate ownership & slot compatibility. */
export function setEquipped(ctx, userId, slot, gearItemId) {
    prepare(ctx.db, 'INSERT INTO equipped (user_id, slot, gear_item_id) VALUES (?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET gear_item_id = excluded.gear_item_id').run(userId, slot, gearItemId);
}
export function unequip(ctx, userId, slot) {
    prepare(ctx.db, 'DELETE FROM equipped WHERE user_id = ? AND slot = ?').run(userId, slot);
}
/** Returns true if newly added, false if the user already had it. */
export function addCosmetic(ctx, userId, cosmeticId, acquiredAt, source) {
    const r = prepare(ctx.db, 'INSERT OR IGNORE INTO cosmetics (user_id, cosmetic_id, acquired_at, source) VALUES (?, ?, ?, ?)').run(userId, cosmeticId, acquiredAt, source ?? null);
    return r.changes > 0;
}
export function listCosmetics(ctx, userId) {
    return prepare(ctx.db, 'SELECT cosmetic_id, acquired_at, source FROM cosmetics WHERE user_id = ? ORDER BY acquired_at, cosmetic_id').all(userId);
}
export function hasCosmetic(ctx, userId, cosmeticId) {
    return prepare(ctx.db, 'SELECT 1 FROM cosmetics WHERE user_id = ? AND cosmetic_id = ?').get(userId, cosmeticId) !== undefined;
}
/** Returns the new caught_fish.id. */
export function addCaughtFish(ctx, f) {
    const r = prepare(ctx.db, 'INSERT INTO caught_fish (user_id, species_id, weight, quality, value, location, caught_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(f.userId, f.speciesId, f.weight, f.quality, f.value, f.location, f.caughtAt);
    return Number(r.lastInsertRowid);
}
const ORDER_SQL = {
    value_desc: 'value DESC, id DESC',
    caught_desc: 'caught_at DESC, id DESC',
    weight_desc: 'weight DESC, id DESC',
};
export function listCaughtFish(ctx, userId, opts = {}) {
    const where = opts.includeStaked ? 'user_id = ?' : 'user_id = ? AND staked = 0';
    const order = ORDER_SQL[opts.orderBy ?? 'caught_desc'];
    return prepare(ctx.db, `SELECT * FROM caught_fish WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(userId, opts.limit ?? -1, opts.offset ?? 0);
}
export function getCaughtFish(ctx, fishId) {
    return prepare(ctx.db, 'SELECT * FROM caught_fish WHERE id = ?').get(fishId);
}
/** Fish in the cage (unstaked by default). */
export function countCaughtFish(ctx, userId, includeStaked = false) {
    const sql = includeStaked
        ? 'SELECT COUNT(*) AS n FROM caught_fish WHERE user_id = ?'
        : 'SELECT COUNT(*) AS n FROM caught_fish WHERE user_id = ? AND staked = 0';
    return prepare(ctx.db, sql).get(userId).n;
}
/** Deletes the given fish owned by userId. Returns the number of rows deleted. */
export function deleteCaughtFish(ctx, userId, fishIds) {
    const stmt = prepare(ctx.db, 'DELETE FROM caught_fish WHERE id = ? AND user_id = ?');
    let n = 0;
    for (const id of fishIds)
        n += stmt.run(id, userId).changes;
    return n;
}
/** Marks fish as staked (1) / unstaked (0). Returns the number of rows changed. */
export function setFishStaked(ctx, userId, fishIds, staked) {
    const stmt = prepare(ctx.db, 'UPDATE caught_fish SET staked = ? WHERE id = ? AND user_id = ?');
    let n = 0;
    for (const id of fishIds)
        n += stmt.run(staked ? 1 : 0, id, userId).changes;
    return n;
}
//# sourceMappingURL=inventory.js.map