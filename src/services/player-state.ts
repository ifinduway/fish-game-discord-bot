// Read-only player state (energy, aggregated gear stats, equipped gear, bait) — cross-WP contract (WP2).
// getPlayerState never writes. ensurePlayerReady creates the player and grants starter gear (writes).
import type { GameContext } from '../core/context.js';
import { GEAR, GEAR_BY_ID } from '../data/gear.js';
import { GEAR_SLOTS, type GearDef, type GearSlot, type Rarity } from '../data/types.js';
import { addGearItem, getActiveBait, getEquippedItems, listGearItems, setEquipped } from '../db/repos/inventory.js';
import { getPlayer, type PlayerRow } from '../db/repos/players.js';
import { castCostFor, currentEnergy, energyParams, msToFull } from '../game/energy.js';
import { aggregateStats, type AggregatedStats } from '../game/gear-stats.js';
import { getOrCreatePlayer } from './player.js';
import { BALANCE } from '../config/balance.js';

export interface EquippedGear {
  slot: GearSlot;
  gearItemId: number;
  gearId: string;
  name: string;
  emoji: string;
  tier: Rarity;
  upgrade: number;
}

export interface PlayerState {
  /** current (lazily regenerated) energy, may be fractional */
  energy: number;
  maxEnergy: number;
  castCost: number;
  regenMsPerPoint: number;
  msToFull: number;
  /** aggregated upgraded stats of equipped gear (maxWeight falls back to the base line max weight) */
  stats: AggregatedStats;
  equipped: EquippedGear[];
  bait: { itemId: string; castsLeft: number } | null;
}

/** Equipped gear with catalog info (items whose catalog id is unknown are skipped). */
export function getEquippedGear(ctx: GameContext, userId: string): EquippedGear[] {
  const rows = getEquippedItems(ctx, userId);
  const out: EquippedGear[] = [];
  for (const slot of GEAR_SLOTS) {
    const row = rows[slot];
    if (!row) continue;
    const def = GEAR_BY_ID[row.gear_id];
    if (!def) continue;
    out.push({ slot, gearItemId: row.id, gearId: def.id, name: def.name, emoji: def.emoji, tier: def.tier, upgrade: row.upgrade });
  }
  return out;
}

export function statsOf(equipped: readonly EquippedGear[]): AggregatedStats {
  return aggregateStats(equipped.map((e) => ({ def: GEAR_BY_ID[e.gearId]!, upgrade: e.upgrade })));
}

/** Computes the state for an existing player row (no writes). */
export function stateFor(ctx: GameContext, player: PlayerRow | undefined, userId: string): PlayerState {
  const equipped = player ? getEquippedGear(ctx, userId) : [];
  const stats = statsOf(equipped);
  const params = energyParams(stats);
  const now = ctx.clock.now();
  const energy = player ? currentEnergy(player.energy, player.energy_updated_at, now, params) : BALANCE.energy.max;
  const bait = player ? getActiveBait(ctx, userId) : undefined;
  return {
    energy,
    maxEnergy: params.max,
    castCost: castCostFor(stats),
    regenMsPerPoint: params.regenMsPerPoint,
    msToFull: msToFull(energy, params),
    stats,
    equipped,
    bait: bait && bait.casts_left > 0 ? { itemId: bait.item_id, castsLeft: bait.casts_left } : null,
  };
}

/** Read-only snapshot of a player's energy/gear/bait. A missing player yields default (full energy, no gear). */
export function getPlayerState(ctx: GameContext, userId: string): PlayerState {
  return stateFor(ctx, getPlayer(ctx, userId), userId);
}

/** Cheapest common gear of each slot (starter kit). */
export function starterGear(): Partial<Record<GearSlot, GearDef>> {
  const out: Partial<Record<GearSlot, GearDef>> = {};
  for (const slot of GEAR_SLOTS) {
    const candidates = GEAR.filter((g) => g.slot === slot && g.tier === 'common');
    candidates.sort((a, b) => (a.shopPrice ?? Infinity) - (b.shopPrice ?? Infinity) || a.unlockLevel - b.unlockLevel);
    if (candidates[0]) out[slot] = candidates[0];
  }
  return out;
}

/**
 * Creates the player if needed and grants + equips the starter kit for every slot where the player owns no gear.
 * Idempotent. Runs in a transaction.
 */
export function ensurePlayerReady(ctx: GameContext, userId: string, username?: string): PlayerRow {
  return ctx.db.transaction(() => {
    const player = getOrCreatePlayer(ctx, userId, username);
    const owned = listGearItems(ctx, userId);
    const equipped = getEquippedItems(ctx, userId);
    const now = ctx.clock.now();
    for (const [slot, def] of Object.entries(starterGear()) as [GearSlot, GearDef][]) {
      const ownsSlot = owned.some((g) => GEAR_BY_ID[g.gear_id]?.slot === slot);
      if (ownsSlot || equipped[slot]) continue;
      const id = addGearItem(ctx, userId, def.id, now);
      setEquipped(ctx, userId, slot, id);
    }
    return player;
  })();
}
