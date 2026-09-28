// Fishing service (spec §1–§3): cast → bite → hook → (reel) → catch/escape. In-memory sessions (one per user),
// DB mutations in transactions, events emitted after commit. Time is always passed in (`at`) so tests need no real timers.
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { timeOfDay } from '../core/time.js';
import { CONSUMABLE_BY_ID } from '../data/consumables.js';
import { FISH, JUNK_ITEMS } from '../data/fish.js';
import { LOCATION_BY_ID } from '../data/locations.js';
import type { FishSpecies, JunkItem, LocationDef, LocationId, SeasonThemeId } from '../data/types.js';
import { prepare, type DbCtx } from '../db/database.js';
import { addCaughtFish, clearActiveBait, countCaughtFish, setActiveBait } from '../db/repos/inventory.js';
import { getPlayer, requirePlayer, setEnergy, updatePlayer } from '../db/repos/players.js';
import { addCoins, addPearls } from '../db/repos/wallet.js';
import { catchXp, effectiveJunkChance, finalQuality, perfectWeight, rollCast, rollQuality, type CastRoll } from '../game/catch.js';
import { applyRefund, currentEnergy, energyParams, escapeRefund, msUntil } from '../game/energy.js';
import { fishValue } from '../game/economy.js';
import {
  DIRECTIONS,
  applyReelResult,
  evaluateHook,
  evaluateReelPress,
  hookWindow,
  reelEscapeThreshold,
  reelRoundTime,
  reelRounds,
  type Direction,
  type HookWindow,
  type ReelPress,
  type ReelState,
} from '../game/fishing-session.js';
import { lineMistakeBonus, type AggregatedStats } from '../game/gear-stats.js';
import { recordCollection, updateSpeciesRecord } from './collection.js';
import { addXp } from './player.js';
import { ensurePlayerReady, stateFor } from './player-state.js';

const F = BALANCE.fishing;

// ───────────────────────── sessions & timers ─────────────────────────

export type SessionPhase = 'waiting' | 'bite' | 'reel' | 'done';

export interface ReelSessionState extends ReelState {
  target: Direction;
  /** when the round's buttons became visible (null until the edit resolves) */
  roundStartedAt: number | null;
  roundTimeMs: number;
}

export interface FishingSession {
  id: string;
  userId: string;
  location: LocationId;
  castCost: number;
  createdAt: number;
  outcome: CastRoll;
  seasonal: boolean;
  /** gear stats snapshot at cast time */
  stats: AggregatedStats;
  window: HookWindow;
  phase: SessionPhase;
  biteShownAt: number | null;
  perfect: boolean;
  reel: ReelSessionState | null;
  timer: unknown;
  /** opaque slot for the discord layer (e.g. an edit callback) */
  ui?: unknown;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};
let timers: Timers = realTimers;

/** Replaces the timer implementation (tests). `null` restores real timers. */
export function setFishingTimers(t: Timers | null): void {
  timers = t ?? realTimers;
}

const sessionsByUser = new Map<string, FishingSession>();
const sessionsById = new Map<string, FishingSession>();
let seq = 0;

export function getSession(userId: string): FishingSession | undefined {
  return sessionsByUser.get(userId);
}

export function getSessionById(id: string): FishingSession | undefined {
  return sessionsById.get(id);
}

/** Drops all sessions and their timers (tests / shutdown). */
export function clearSessions(): void {
  for (const s of sessionsById.values()) if (s.timer !== null) timers.clearTimeout(s.timer);
  sessionsByUser.clear();
  sessionsById.clear();
}

/** Schedules `fn` for the session (replacing its previous timer). Skipped if the session already ended. */
export function scheduleSession(sessionId: string, ms: number, fn: () => void): void {
  const s = sessionsById.get(sessionId);
  if (!s || s.phase === 'done') return;
  if (s.timer !== null) timers.clearTimeout(s.timer);
  s.timer = timers.setTimeout(() => {
    s.timer = null;
    fn();
  }, Math.max(0, ms));
}

function endSession(s: FishingSession): void {
  s.phase = 'done';
  if (s.timer !== null) timers.clearTimeout(s.timer);
  s.timer = null;
  if (sessionsByUser.get(s.userId) === s) sessionsByUser.delete(s.userId);
  sessionsById.delete(s.id);
}

// ───────────────────────── read-only helpers ─────────────────────────

/** Active season (read-only; WP3 owns the lifecycle). */
export function activeSeason(ctx: DbCtx): { id: number; themeId: SeasonThemeId } | null {
  const r = prepare(ctx.db, "SELECT id, theme_id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as
    | { id: number; theme_id: SeasonThemeId }
    | undefined;
  return r ? { id: r.id, themeId: r.theme_id } : null;
}

/** true while a bite-hour server event is active (read-only; WP4 owns server_events). */
export function isBiteHour(ctx: DbCtx, now: number): boolean {
  return (
    prepare(ctx.db, "SELECT 1 FROM server_events WHERE type = 'bite_hour' AND status = 'active' AND starts_at <= ? AND ends_at > ? LIMIT 1").get(now, now) !==
    undefined
  );
}

// ───────────────────────── cast ─────────────────────────

export type CastError =
  | { code: 'busy' }
  | { code: 'locked'; location: LocationDef; level: number }
  | { code: 'cage_full'; count: number; capacity: number }
  | { code: 'no_energy'; energy: number; cost: number; msUntil: number };

export interface CastOptions {
  username?: string;
  /** chosen location (remembered in players.location); defaults to the remembered one */
  location?: LocationId | null;
  /** tests only: skip the outcome roll */
  forceOutcome?: CastRoll;
}

export type CastResult =
  | { ok: true; session: FishingSession; energy: number; maxEnergy: number; bait: { itemId: string; castsLeft: number } | null; biteHour: boolean; notices: Notice[] }
  | { ok: false; error: CastError };

export function startCast(ctx: GameContext, userId: string, opts: CastOptions = {}): CastResult {
  const now = ctx.clock.now();
  const existing = sessionsByUser.get(userId);
  if (existing) {
    if (existing.phase !== 'done' && now - existing.createdAt < F.sessionTtlMs) return { ok: false, error: { code: 'busy' } };
    endSession(existing); // abandoned
  }

  const player = ensurePlayerReady(ctx, userId, opts.username);
  const locDef = LOCATION_BY_ID[(opts.location ?? player.location) as LocationId] ?? LOCATION_BY_ID.pond;
  if (player.level < locDef.unlockLevel) return { ok: false, error: { code: 'locked', location: locDef, level: player.level } };

  const count = countCaughtFish(ctx, userId);
  if (count >= player.cage_capacity) return { ok: false, error: { code: 'cage_full', count, capacity: player.cage_capacity } };

  const state = stateFor(ctx, player, userId);
  const cost = state.castCost;
  const params = energyParams(state.stats);
  if (state.energy + 1e-9 < cost) {
    return { ok: false, error: { code: 'no_energy', energy: state.energy, cost, msUntil: msUntil(state.energy, cost, params) } };
  }

  const tz = ctx.config.timezone;
  const tod = timeOfDay(now, tz);
  const season = activeSeason(ctx);
  const biteHour = isBiteHour(ctx, now);
  const baitDef = state.bait ? CONSUMABLE_BY_ID[state.bait.itemId]?.bait : undefined;
  const baitActive = !!baitDef && (!baitDef.timeOfDay || baitDef.timeOfDay.length === 0 || baitDef.timeOfDay.includes(tod));
  const outcome =
    opts.forceOutcome ??
    rollCast(ctx.rng, {
      species: FISH,
      junk: JUNK_ITEMS,
      junkChance: effectiveJunkChance(locDef.junkChance),
      weightBonus: state.stats.weightBonus,
      maxWeight: state.stats.maxWeight,
      rc: {
        location: locDef.id,
        timeOfDay: tod,
        level: player.level,
        seasonTheme: season?.themeId ?? null,
        rarityBonus: state.stats.rarityBonus + (baitActive ? (baitDef!.rarityBonus ?? 0) : 0),
        rarityMultiplier: biteHour ? BALANCE.events.biteHourRarityMultiplier : 1,
        speciesBoost: baitActive ? (baitDef!.speciesBoost ?? []) : [],
      },
    });

  let baitLeft: { itemId: string; castsLeft: number } | null = null;
  const energyLeft = ctx.db.transaction(() => {
    const p = requirePlayer(ctx, userId);
    const cur = currentEnergy(p.energy, p.energy_updated_at, now, params);
    if (cur + 1e-9 < cost) throw new Error('energy changed during cast');
    const left = Math.max(0, cur - cost);
    setEnergy(ctx, userId, left, now);
    if (p.location !== locDef.id) updatePlayer(ctx, userId, { location: locDef.id });
    if (state.bait) {
      const castsLeft = state.bait.castsLeft - 1;
      if (castsLeft > 0) {
        setActiveBait(ctx, userId, state.bait.itemId, castsLeft);
        baitLeft = { itemId: state.bait.itemId, castsLeft };
      } else clearActiveBait(ctx, userId);
    }
    return left;
  })();

  const session: FishingSession = {
    id: `${now.toString(36)}${(seq++).toString(36)}`,
    userId,
    location: locDef.id,
    castCost: cost,
    createdAt: now,
    outcome,
    seasonal: outcome.kind === 'fish' && !!outcome.species.seasonTheme,
    stats: state.stats,
    window: hookWindow(state.stats.biteWindowMs),
    phase: 'waiting',
    biteShownAt: null,
    perfect: false,
    reel: null,
    timer: null,
  };
  sessionsByUser.set(userId, session);
  sessionsById.set(session.id, session);
  const notices = ctx.bus.emit({ type: 'cast', userId, location: locDef.id, energySpent: cost }, ctx);
  return { ok: true, session, energy: energyLeft, maxEnergy: state.maxEnergy, bait: baitLeft, biteHour, notices };
}

/** Random delay before the bite (1.5–5 s). */
export function biteDelay(ctx: GameContext): number {
  return ctx.rng.int(F.biteDelayMinMs, F.biteDelayMaxMs);
}

/** Marks that the «Клюёт!» message is visible; the hook window starts at `at`. */
export function markBiteShown(sessionId: string, at: number): boolean {
  const s = sessionsById.get(sessionId);
  if (!s || s.phase !== 'waiting') return false;
  s.phase = 'bite';
  s.biteShownAt = at;
  return true;
}

// ───────────────────────── steps ─────────────────────────

export interface CatchResult {
  fishId: number;
  species: FishSpecies;
  weight: number;
  quality: number;
  value: number;
  perfect: boolean;
  mistakes: number;
  firstOfSpecies: boolean;
  /** new server record for the species */
  record: boolean;
  seasonal: boolean;
  xp: number;
  /** first-catch pearls */
  pearls: number;
  location: LocationId;
}

export type FishingStep =
  | { kind: 'invalid' }
  | { kind: 'escaped'; session: FishingSession; reason: 'late' | 'reel' | 'line'; refund: number; energy: number; notices: Notice[] }
  | {
      kind: 'reel';
      session: FishingSession;
      /** 1-based */
      round: number;
      rounds: number;
      target: Direction;
      mistakes: number;
      escapeAt: number;
      roundTimeMs: number;
      perfect: boolean;
      last?: ReelPress;
    }
  | { kind: 'caught'; session: FishingSession; result: CatchResult; notices: Notice[] }
  | { kind: 'junk'; session: FishingSession; item: JunkItem; coins: number; xp: number; notices: Notice[] }
  | { kind: 'treasure'; session: FishingSession; coins: number; pearls: number; notices: Notice[] };

/** Hook button pressed at `at`. */
export function pressHook(ctx: GameContext, sessionId: string, at: number): FishingStep {
  const s = sessionsById.get(sessionId);
  if (!s || s.phase !== 'bite' || s.biteShownAt === null) return { kind: 'invalid' };
  const res = evaluateHook(s.biteShownAt, at, s.window);
  if (res === 'late') return escape(ctx, s, 'late');
  s.perfect = res === 'perfect';
  const o = s.outcome;
  if (o.kind === 'junk') return resolveJunk(ctx, s, o.item);
  if (o.kind === 'treasure') return resolveTreasure(ctx, s, o.coins, o.pearls);
  if (o.snap) return escape(ctx, s, 'line');
  const rounds = reelRounds(o.species.rarity);
  if (rounds === 0) return completeCatch(ctx, s, 0);
  s.phase = 'reel';
  s.reel = {
    rounds,
    round: 0,
    mistakes: 0,
    escapeAt: reelEscapeThreshold(lineMistakeBonus(s.stats)),
    target: ctx.rng.pick(DIRECTIONS),
    roundStartedAt: null,
    roundTimeMs: reelRoundTime(s.stats.reelTimeMs),
  };
  return reelStep(s);
}

/** No press within the hook window. */
export function hookTimeout(ctx: GameContext, sessionId: string, _at: number): FishingStep {
  const s = sessionsById.get(sessionId);
  if (!s || s.phase !== 'bite') return { kind: 'invalid' };
  return escape(ctx, s, 'late');
}

/** Marks that the current reel round's buttons are visible (its timer starts at `at`). */
export function startReelRound(sessionId: string, at: number): boolean {
  const s = sessionsById.get(sessionId);
  if (!s || s.phase !== 'reel' || !s.reel || s.reel.roundStartedAt !== null) return false;
  s.reel.roundStartedAt = at;
  return true;
}

/**
 * Reel direction pressed (or `null` on timeout) for round `round` (0-based). Presses for another round are ignored.
 */
export function pressReel(ctx: GameContext, sessionId: string, round: number, pressed: Direction | null, at: number): FishingStep {
  const s = sessionsById.get(sessionId);
  if (!s || s.phase !== 'reel' || !s.reel || s.reel.round !== round) return { kind: 'invalid' };
  const r = s.reel;
  const result = evaluateReelPress(r.target, pressed, r.roundStartedAt ?? at, at, r.roundTimeMs);
  const { state, status } = applyReelResult(r, result);
  if (status === 'escaped') {
    s.reel = { ...r, ...state };
    return escape(ctx, s, 'reel');
  }
  if (status === 'done') {
    s.reel = { ...r, ...state };
    return completeCatch(ctx, s, state.mistakes);
  }
  s.reel = { ...r, ...state, target: ctx.rng.pick(DIRECTIONS), roundStartedAt: null };
  return reelStep(s, result);
}

/** Cancels a session without penalty (full energy refund, no event) — e.g. the bite message could not be shown. */
export function cancelSession(ctx: GameContext, sessionId: string): boolean {
  const s = sessionsById.get(sessionId);
  if (!s || s.phase === 'done') return false;
  refundEnergy(ctx, s, s.castCost);
  endSession(s);
  return true;
}

function reelStep(s: FishingSession, last?: ReelPress): FishingStep {
  const r = s.reel!;
  return {
    kind: 'reel',
    session: s,
    round: r.round + 1,
    rounds: r.rounds,
    target: r.target,
    mistakes: r.mistakes,
    escapeAt: r.escapeAt,
    roundTimeMs: r.roundTimeMs,
    perfect: s.perfect,
    last,
  };
}

function refundEnergy(ctx: GameContext, s: FishingSession, amount: number): number {
  const now = ctx.clock.now();
  const params = energyParams(s.stats);
  return ctx.db.transaction(() => {
    const p = getPlayer(ctx, s.userId);
    if (!p) return 0;
    const cur = currentEnergy(p.energy, p.energy_updated_at, now, params);
    const next = applyRefund(cur, amount, params.max);
    setEnergy(ctx, s.userId, next, now);
    return next;
  })();
}

function escape(ctx: GameContext, s: FishingSession, reason: 'late' | 'reel' | 'line'): FishingStep {
  const refund = escapeRefund(s.castCost);
  const energy = refundEnergy(ctx, s, refund);
  endSession(s);
  const notices = ctx.bus.emit({ type: 'fish_escaped', userId: s.userId, reason }, ctx);
  return { kind: 'escaped', session: s, reason, refund, energy, notices };
}

function resolveJunk(ctx: GameContext, s: FishingSession, item: JunkItem): FishingStep {
  const notices: Notice[] = [];
  const coins = Math.max(0, Math.floor(item.coins));
  const xp = F.junkXp;
  ctx.db.transaction(() => {
    if (coins > 0) addCoins(ctx, s.userId, coins);
    if (xp > 0) notices.push(...addXp(ctx, s.userId, xp).notices);
  })();
  endSession(s);
  notices.push(...ctx.bus.emit({ type: 'junk_caught', userId: s.userId, itemName: item.name }, ctx));
  return { kind: 'junk', session: s, item, coins, xp, notices };
}

function resolveTreasure(ctx: GameContext, s: FishingSession, coins: number, pearls: number): FishingStep {
  ctx.db.transaction(() => {
    if (coins > 0) addCoins(ctx, s.userId, coins);
    if (pearls > 0) addPearls(ctx, s.userId, pearls);
  })();
  endSession(s);
  const notices = ctx.bus.emit({ type: 'treasure_found', userId: s.userId, coins, pearls }, ctx);
  return { kind: 'treasure', session: s, coins, pearls, notices };
}

function completeCatch(ctx: GameContext, s: FishingSession, mistakes: number): FishingStep {
  const o = s.outcome;
  if (o.kind !== 'fish') throw new Error('completeCatch: not a fish outcome');
  const now = ctx.clock.now();
  const species = o.species;
  const quality = finalQuality(rollQuality(ctx.rng), s.perfect, mistakes);
  const weight = s.perfect ? perfectWeight(o.weight) : o.weight;
  const value = fishValue(species, weight, quality);
  const xp = catchXp(species.rarity);
  const notices: Notice[] = [];

  const tx = ctx.db.transaction(() => {
    const fishId = addCaughtFish(ctx, { userId: s.userId, speciesId: species.id, weight, quality, value, location: s.location, caughtAt: now });
    const firstOfSpecies = recordCollection(ctx, s.userId, species.id, weight, quality, now);
    const record = updateSpeciesRecord(ctx, species.id, s.userId, weight, now);
    const pearls = firstOfSpecies ? BALANCE.firstCatchPearls[species.rarity] : 0;
    if (pearls > 0) addPearls(ctx, s.userId, pearls);
    notices.push(...addXp(ctx, s.userId, xp).notices);
    return { fishId, firstOfSpecies, record, pearls };
  })();

  endSession(s);
  const result: CatchResult = {
    fishId: tx.fishId,
    species,
    weight,
    quality,
    value,
    perfect: s.perfect,
    mistakes,
    firstOfSpecies: tx.firstOfSpecies,
    record: tx.record,
    seasonal: s.seasonal,
    xp,
    pearls: tx.pearls,
    location: s.location,
  };
  notices.push(
    ...ctx.bus.emit(
      {
        type: 'fish_caught',
        userId: s.userId,
        speciesId: species.id,
        rarity: species.rarity,
        weight,
        quality,
        perfect: s.perfect,
        location: s.location,
        value,
        firstOfSpecies: tx.firstOfSpecies,
        seasonal: s.seasonal,
      },
      ctx,
    ),
  );
  return { kind: 'caught', session: s, result, notices };
}
