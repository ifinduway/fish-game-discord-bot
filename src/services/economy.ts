// Economy service (spec §1, §5): selling fish, daily login, using consumables (energy drinks, bait).
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { dayKey, nextDayReset, prevDayKey } from '../core/time.js';
import { CONSUMABLE_BY_ID } from '../data/consumables.js';
import { FISH_BY_ID } from '../data/fish.js';
import type { ConsumableDef, Rarity } from '../data/types.js';
import { prepare } from '../db/database.js';
import { getActiveBait, getConsumableQty, removeConsumable, setActiveBait, type CaughtFishRow } from '../db/repos/inventory.js';
import { requirePlayer, setEnergy, updatePlayer } from '../db/repos/players.js';
import { addCoins, addPearls } from '../db/repos/wallet.js';
import { dailyReward } from '../game/economy.js';
import { applyDrink } from '../game/energy.js';
import { getOrCreatePlayer } from './player.js';
import { stateFor } from './player-state.js';

// ───────────────────────── selling ─────────────────────────

export type SellFilter = { kind: 'all' } | { kind: 'rarity'; rarity: Rarity } | { kind: 'fish'; fishId: number };

export interface SellResult {
  count: number;
  coins: number;
  notices: Notice[];
}

/**
 * Sells unstaked fish matching the filter (never staked fish). Atomic; coins = sum of stored values.
 * Emits `fish_sold` when something was sold.
 */
export function sellFish(ctx: GameContext, userId: string, filter: SellFilter): SellResult {
  getOrCreatePlayer(ctx, userId);
  const { count, coins } = ctx.db.transaction(() => {
    const rows = prepare(ctx.db, 'SELECT * FROM caught_fish WHERE user_id = ? AND staked = 0 ORDER BY id').all(userId) as CaughtFishRow[];
    const selected = rows.filter((f) => {
      if (filter.kind === 'fish') return f.id === filter.fishId;
      if (filter.kind === 'rarity') return FISH_BY_ID[f.species_id]?.rarity === filter.rarity;
      return true;
    });
    const del = prepare(ctx.db, 'DELETE FROM caught_fish WHERE id = ? AND user_id = ? AND staked = 0');
    let count = 0;
    let coins = 0;
    for (const f of selected) {
      if (del.run(f.id, userId).changes > 0) {
        count++;
        coins += Math.max(0, Math.floor(f.value));
      }
    }
    if (coins > 0) addCoins(ctx, userId, coins);
    return { count, coins };
  })();
  const notices = count > 0 ? ctx.bus.emit({ type: 'fish_sold', userId, count, coins }, ctx) : [];
  return { count, coins, notices };
}

/** Unstaked fish ordered by value (for autocomplete / inventory). */
export function listSellable(ctx: GameContext, userId: string, limit = 25): CaughtFishRow[] {
  return prepare(ctx.db, 'SELECT * FROM caught_fish WHERE user_id = ? AND staked = 0 ORDER BY value DESC, id DESC LIMIT ?').all(userId, limit) as CaughtFishRow[];
}

/** Count and total value of unstaked fish (optionally by rarity). */
export function cageSummary(ctx: GameContext, userId: string): { count: number; value: number; byRarity: Partial<Record<Rarity, { count: number; value: number }>> } {
  const rows = prepare(ctx.db, 'SELECT species_id, value FROM caught_fish WHERE user_id = ? AND staked = 0').all(userId) as { species_id: string; value: number }[];
  const byRarity: Partial<Record<Rarity, { count: number; value: number }>> = {};
  let value = 0;
  for (const r of rows) {
    value += r.value;
    const rar = FISH_BY_ID[r.species_id]?.rarity;
    if (!rar) continue;
    const e = (byRarity[rar] ??= { count: 0, value: 0 });
    e.count++;
    e.value += r.value;
  }
  return { count: rows.length, value, byRarity };
}

// ───────────────────────── daily ─────────────────────────

export type DailyClaim =
  | { ok: true; streak: number; pearls: number; nextResetAt: number; notices: Notice[] }
  | { ok: false; reason: 'already_claimed'; streak: number; nextResetAt: number };

/** /daily: pearls = 3 + 1 per streak day beyond the first (max 10). Once per server-tz day; a missed day resets the streak. */
export function claimDaily(ctx: GameContext, userId: string, username?: string): DailyClaim {
  const now = ctx.clock.now();
  const tz = ctx.config.timezone;
  const today = dayKey(now, tz);
  const nextResetAt = nextDayReset(now, tz);
  const res = ctx.db.transaction(() => {
    const p = getOrCreatePlayer(ctx, userId, username);
    const r = dailyReward(p.last_daily_key, p.daily_streak, today, prevDayKey(now, tz));
    if (!r.ok) return { ok: false as const, streak: p.daily_streak };
    updatePlayer(ctx, userId, { daily_streak: r.streak, last_daily_key: today });
    addPearls(ctx, userId, r.pearls);
    return r;
  })();
  if (!res.ok) return { ok: false, reason: 'already_claimed', streak: res.streak, nextResetAt };
  const notices = ctx.bus.emit({ type: 'daily_claimed', userId, streak: res.streak }, ctx);
  return { ok: true, streak: res.streak, pearls: res.pearls, nextResetAt, notices };
}

// ───────────────────────── use consumables ─────────────────────────

export type UseResult =
  | { ok: true; kind: 'energy'; item: ConsumableDef; energy: number; gained: number; maxEnergy: number; drinksLeft: number }
  | { ok: true; kind: 'bait'; item: ConsumableDef; castsLeft: number; replaced: string | null }
  | { ok: false; reason: 'unknown' | 'not_owned' | 'drink_limit' | 'energy_full' | 'not_usable' };

/** /use: energy drink (+30 ⚡ up to 150% max, ≤3/day) or bait (becomes the active bait; same bait stacks casts). */
export function useItem(ctx: GameContext, userId: string, itemId: string): UseResult {
  const def = CONSUMABLE_BY_ID[itemId];
  if (!def) return { ok: false, reason: 'unknown' };
  getOrCreatePlayer(ctx, userId);
  return ctx.db.transaction((): UseResult => {
    if (getConsumableQty(ctx, userId, itemId) < 1) return { ok: false, reason: 'not_owned' };
    if (def.kind === 'energy') {
      const now = ctx.clock.now();
      const today = dayKey(now, ctx.config.timezone);
      const p = requirePlayer(ctx, userId);
      const state = stateFor(ctx, p, userId);
      const used = p.drinks_day_key === today ? p.drinks_used : 0;
      const r = applyDrink(state.energy, state.maxEnergy, used, def.energy ?? BALANCE.energy.drinkEnergy);
      if (!r.ok) return { ok: false, reason: r.reason === 'limit' ? 'drink_limit' : 'energy_full' };
      removeConsumable(ctx, userId, itemId, 1);
      setEnergy(ctx, userId, r.energy, now);
      updatePlayer(ctx, userId, { drinks_day_key: today, drinks_used: r.drinksUsed });
      return { ok: true, kind: 'energy', item: def, energy: r.energy, gained: r.gained, maxEnergy: state.maxEnergy, drinksLeft: BALANCE.energy.drinksPerDay - r.drinksUsed };
    }
    if (def.kind === 'bait' && def.bait) {
      const cur = getActiveBait(ctx, userId);
      const same = cur && cur.item_id === itemId && cur.casts_left > 0;
      const castsLeft = (same ? cur.casts_left : 0) + def.bait.casts;
      removeConsumable(ctx, userId, itemId, 1);
      setActiveBait(ctx, userId, itemId, castsLeft);
      const replaced = cur && !same && cur.casts_left > 0 ? cur.item_id : null;
      return { ok: true, kind: 'bait', item: def, castsLeft, replaced };
    }
    return { ok: false, reason: 'not_usable' };
  })();
}
