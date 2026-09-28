// Inventory repos: consumables, active bait, gear items, equipped slots, cosmetics, caught fish (садок).
// All functions are plain statements and work inside a caller's transaction.
import type { GearSlot, LocationId } from '../../data/types.js';
import { prepare, type DbCtx } from '../database.js';

export class InsufficientItemsError extends Error {
  constructor(
    public readonly itemId: string,
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`Insufficient item ${itemId}: need ${required}, have ${available}`);
    this.name = 'InsufficientItemsError';
  }
}

function assertQty(qty: number): void {
  if (!Number.isInteger(qty) || qty < 0) throw new Error(`Invalid quantity: ${qty}`);
}

// ───────────────────────── consumables ─────────────────────────

export interface ConsumableRow {
  item_id: string;
  qty: number;
}

export function listConsumables(ctx: DbCtx, userId: string): ConsumableRow[] {
  return prepare(ctx.db, 'SELECT item_id, qty FROM consumables WHERE user_id = ? AND qty > 0 ORDER BY item_id').all(userId) as ConsumableRow[];
}

export function getConsumableQty(ctx: DbCtx, userId: string, itemId: string): number {
  const r = prepare(ctx.db, 'SELECT qty FROM consumables WHERE user_id = ? AND item_id = ?').get(userId, itemId) as { qty: number } | undefined;
  return r?.qty ?? 0;
}

/** Returns the new quantity. */
export function addConsumable(ctx: DbCtx, userId: string, itemId: string, qty: number): number {
  assertQty(qty);
  prepare(
    ctx.db,
    'INSERT INTO consumables (user_id, item_id, qty) VALUES (?, ?, ?) ON CONFLICT(user_id, item_id) DO UPDATE SET qty = qty + excluded.qty',
  ).run(userId, itemId, qty);
  return getConsumableQty(ctx, userId, itemId);
}

/** Returns the new quantity; throws InsufficientItemsError (nothing changed) if not enough. */
export function removeConsumable(ctx: DbCtx, userId: string, itemId: string, qty: number): number {
  assertQty(qty);
  const r = prepare(ctx.db, 'UPDATE consumables SET qty = qty - ? WHERE user_id = ? AND item_id = ? AND qty >= ?').run(qty, userId, itemId, qty);
  if (r.changes === 0) throw new InsufficientItemsError(itemId, qty, getConsumableQty(ctx, userId, itemId));
  prepare(ctx.db, 'DELETE FROM consumables WHERE user_id = ? AND item_id = ? AND qty = 0').run(userId, itemId);
  return getConsumableQty(ctx, userId, itemId);
}

// ───────────────────────── active bait ─────────────────────────

export interface ActiveBaitRow {
  item_id: string;
  casts_left: number;
}

export function getActiveBait(ctx: DbCtx, userId: string): ActiveBaitRow | undefined {
  return prepare(ctx.db, 'SELECT item_id, casts_left FROM active_bait WHERE user_id = ?').get(userId) as ActiveBaitRow | undefined;
}

export function setActiveBait(ctx: DbCtx, userId: string, itemId: string, castsLeft: number): void {
  prepare(
    ctx.db,
    'INSERT INTO active_bait (user_id, item_id, casts_left) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET item_id = excluded.item_id, casts_left = excluded.casts_left',
  ).run(userId, itemId, castsLeft);
}

export function clearActiveBait(ctx: DbCtx, userId: string): void {
  prepare(ctx.db, 'DELETE FROM active_bait WHERE user_id = ?').run(userId);
}

// ───────────────────────── gear items ─────────────────────────

export interface GearItemRow {
  id: number;
  user_id: string;
  gear_id: string;
  upgrade: number;
  acquired_at: number;
}

/** Returns the new gear_items.id. */
export function addGearItem(ctx: DbCtx, userId: string, gearId: string, acquiredAt: number, upgrade = 0): number {
  const r = prepare(ctx.db, 'INSERT INTO gear_items (user_id, gear_id, upgrade, acquired_at) VALUES (?, ?, ?, ?)').run(userId, gearId, upgrade, acquiredAt);
  return Number(r.lastInsertRowid);
}

export function listGearItems(ctx: DbCtx, userId: string): GearItemRow[] {
  return prepare(ctx.db, 'SELECT * FROM gear_items WHERE user_id = ? ORDER BY id').all(userId) as GearItemRow[];
}

export function getGearItem(ctx: DbCtx, gearItemId: number): GearItemRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM gear_items WHERE id = ?').get(gearItemId) as GearItemRow | undefined;
}

/** true if the user owns at least one gear item with this catalog id. */
export function hasGear(ctx: DbCtx, userId: string, gearId: string): boolean {
  return prepare(ctx.db, 'SELECT 1 FROM gear_items WHERE user_id = ? AND gear_id = ? LIMIT 1').get(userId, gearId) !== undefined;
}

export function setGearUpgrade(ctx: DbCtx, gearItemId: number, upgrade: number): void {
  prepare(ctx.db, 'UPDATE gear_items SET upgrade = ? WHERE id = ?').run(upgrade, gearItemId);
}

/** Deletes a gear item (and unequips it first). */
export function deleteGearItem(ctx: DbCtx, gearItemId: number): void {
  prepare(ctx.db, 'DELETE FROM equipped WHERE gear_item_id = ?').run(gearItemId);
  prepare(ctx.db, 'DELETE FROM gear_items WHERE id = ?').run(gearItemId);
}

// ───────────────────────── equipped ─────────────────────────

/** slot → gear_items.id */
export function getEquipped(ctx: DbCtx, userId: string): Partial<Record<GearSlot, number>> {
  const rows = prepare(ctx.db, 'SELECT slot, gear_item_id FROM equipped WHERE user_id = ?').all(userId) as { slot: GearSlot; gear_item_id: number }[];
  const out: Partial<Record<GearSlot, number>> = {};
  for (const r of rows) out[r.slot] = r.gear_item_id;
  return out;
}

/** slot → full gear item row */
export function getEquippedItems(ctx: DbCtx, userId: string): Partial<Record<GearSlot, GearItemRow>> {
  const rows = prepare(
    ctx.db,
    'SELECT e.slot AS slot, g.* FROM equipped e JOIN gear_items g ON g.id = e.gear_item_id WHERE e.user_id = ?',
  ).all(userId) as (GearItemRow & { slot: GearSlot })[];
  const out: Partial<Record<GearSlot, GearItemRow>> = {};
  for (const { slot, ...item } of rows) out[slot] = item;
  return out;
}

/** Caller must validate ownership & slot compatibility. */
export function setEquipped(ctx: DbCtx, userId: string, slot: GearSlot, gearItemId: number): void {
  prepare(
    ctx.db,
    'INSERT INTO equipped (user_id, slot, gear_item_id) VALUES (?, ?, ?) ON CONFLICT(user_id, slot) DO UPDATE SET gear_item_id = excluded.gear_item_id',
  ).run(userId, slot, gearItemId);
}

export function unequip(ctx: DbCtx, userId: string, slot: GearSlot): void {
  prepare(ctx.db, 'DELETE FROM equipped WHERE user_id = ? AND slot = ?').run(userId, slot);
}

// ───────────────────────── cosmetics ─────────────────────────

export interface CosmeticRow {
  cosmetic_id: string;
  acquired_at: number;
  source: string | null;
}

/** Returns true if newly added, false if the user already had it. */
export function addCosmetic(ctx: DbCtx, userId: string, cosmeticId: string, acquiredAt: number, source?: string): boolean {
  const r = prepare(ctx.db, 'INSERT OR IGNORE INTO cosmetics (user_id, cosmetic_id, acquired_at, source) VALUES (?, ?, ?, ?)').run(
    userId,
    cosmeticId,
    acquiredAt,
    source ?? null,
  );
  return r.changes > 0;
}

export function listCosmetics(ctx: DbCtx, userId: string): CosmeticRow[] {
  return prepare(ctx.db, 'SELECT cosmetic_id, acquired_at, source FROM cosmetics WHERE user_id = ? ORDER BY acquired_at, cosmetic_id').all(
    userId,
  ) as CosmeticRow[];
}

export function hasCosmetic(ctx: DbCtx, userId: string, cosmeticId: string): boolean {
  return prepare(ctx.db, 'SELECT 1 FROM cosmetics WHERE user_id = ? AND cosmetic_id = ?').get(userId, cosmeticId) !== undefined;
}

// ───────────────────────── caught fish (садок) ─────────────────────────

export interface CaughtFishRow {
  id: number;
  user_id: string;
  species_id: string;
  weight: number;
  quality: number;
  value: number;
  location: LocationId;
  caught_at: number;
  staked: number;
}

export interface NewCaughtFish {
  userId: string;
  speciesId: string;
  weight: number;
  quality: number;
  value: number;
  location: LocationId;
  caughtAt: number;
}

/** Returns the new caught_fish.id. */
export function addCaughtFish(ctx: DbCtx, f: NewCaughtFish): number {
  const r = prepare(
    ctx.db,
    'INSERT INTO caught_fish (user_id, species_id, weight, quality, value, location, caught_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(f.userId, f.speciesId, f.weight, f.quality, f.value, f.location, f.caughtAt);
  return Number(r.lastInsertRowid);
}

export interface ListFishOptions {
  /** include fish currently staked in blackjack (default false) */
  includeStaked?: boolean;
  orderBy?: 'value_desc' | 'caught_desc' | 'weight_desc';
  limit?: number;
  offset?: number;
}

const ORDER_SQL: Record<NonNullable<ListFishOptions['orderBy']>, string> = {
  value_desc: 'value DESC, id DESC',
  caught_desc: 'caught_at DESC, id DESC',
  weight_desc: 'weight DESC, id DESC',
};

export function listCaughtFish(ctx: DbCtx, userId: string, opts: ListFishOptions = {}): CaughtFishRow[] {
  const where = opts.includeStaked ? 'user_id = ?' : 'user_id = ? AND staked = 0';
  const order = ORDER_SQL[opts.orderBy ?? 'caught_desc'];
  return prepare(ctx.db, `SELECT * FROM caught_fish WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(
    userId,
    opts.limit ?? -1,
    opts.offset ?? 0,
  ) as CaughtFishRow[];
}

export function getCaughtFish(ctx: DbCtx, fishId: number): CaughtFishRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM caught_fish WHERE id = ?').get(fishId) as CaughtFishRow | undefined;
}

/** Fish in the cage (unstaked by default). */
export function countCaughtFish(ctx: DbCtx, userId: string, includeStaked = false): number {
  const sql = includeStaked
    ? 'SELECT COUNT(*) AS n FROM caught_fish WHERE user_id = ?'
    : 'SELECT COUNT(*) AS n FROM caught_fish WHERE user_id = ? AND staked = 0';
  return (prepare(ctx.db, sql).get(userId) as { n: number }).n;
}

/** Deletes the given fish owned by userId. Returns the number of rows deleted. */
export function deleteCaughtFish(ctx: DbCtx, userId: string, fishIds: number[]): number {
  const stmt = prepare(ctx.db, 'DELETE FROM caught_fish WHERE id = ? AND user_id = ?');
  let n = 0;
  for (const id of fishIds) n += stmt.run(id, userId).changes;
  return n;
}

/** Marks fish as staked (1) / unstaked (0). Returns the number of rows changed. */
export function setFishStaked(ctx: DbCtx, userId: string, fishIds: number[], staked: boolean): number {
  const stmt = prepare(ctx.db, 'UPDATE caught_fish SET staked = ? WHERE id = ? AND user_id = ?');
  let n = 0;
  for (const id of fishIds) n += stmt.run(staked ? 1 : 0, id, userId).changes;
  return n;
}
