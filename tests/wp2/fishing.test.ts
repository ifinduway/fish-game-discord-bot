import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { GameEvent } from '../../src/core/events.js';
import { CONSUMABLES } from '../../src/data/consumables.js';
import { FISH } from '../../src/data/fish.js';
import type { FishSpecies } from '../../src/data/types.js';
import { addCaughtFish, addConsumable, countCaughtFish, getActiveBait } from '../../src/db/repos/inventory.js';
import { getPlayer, setEnergy } from '../../src/db/repos/players.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import type { CastRoll } from '../../src/game/catch.js';
import { useItem } from '../../src/services/economy.js';
import { getSpeciesRecord, listCollection } from '../../src/services/collection.js';
import {
  clearSessions,
  getSession,
  hookTimeout,
  isBiteHour,
  markBiteShown,
  pressHook,
  pressReel,
  scheduleSession,
  setFishingTimers,
  startCast,
  startReelRound,
  type FishingStep,
} from '../../src/services/fishing.js';
import { getPlayerState } from '../../src/services/player-state.js';
import { createTestContext, type TestContext } from '../helpers.js';

afterEach(() => {
  clearSessions();
  setFishingTimers(null);
});

const pondFish = (r: FishSpecies['rarity']) => FISH.find((f) => f.rarity === r && f.locations.includes('pond') && !f.seasonTheme)!;
const COMMON = pondFish('common');
const RARE = FISH.find((f) => f.rarity === 'rare' && !f.seasonTheme)!;
const EPIC = FISH.find((f) => f.rarity === 'epic' && !f.seasonTheme)!;
const fish = (species: FishSpecies, weight = species.minWeight, snap = false): CastRoll => ({ kind: 'fish', species, weight, snap });

function collect(ctx: TestContext): GameEvent[] {
  const out: GameEvent[] = [];
  for (const t of ['cast', 'fish_caught', 'fish_escaped', 'junk_caught', 'treasure_found'] as const) ctx.bus.on(t, (e) => void out.push(e));
  return out;
}

/** Casts with a forced outcome and makes the bite visible. */
function castAndBite(ctx: TestContext, outcome: CastRoll, userId = 'u1') {
  const r = startCast(ctx, userId, { forceOutcome: outcome });
  if (!r.ok) throw new Error(`cast failed: ${r.error.code}`);
  markBiteShown(r.session.id, ctx.clock.now());
  return r.session;
}

function energy(ctx: TestContext, userId = 'u1'): number {
  return getPlayerState(ctx, userId).energy;
}

describe('cast', () => {
  it('deducts 8 energy, emits cast, remembers the location, one session per user', () => {
    const ctx = createTestContext();
    const ev = collect(ctx);
    const r = startCast(ctx, 'u1', { location: 'pond', forceOutcome: fish(COMMON) });
    expect(r.ok).toBe(true);
    expect(energy(ctx)).toBeCloseTo(BALANCE.energy.max - 8);
    expect(ev).toEqual([{ type: 'cast', userId: 'u1', location: 'pond', energySpent: 8 }]);
    expect(startCast(ctx, 'u1')).toEqual({ ok: false, error: { code: 'busy' } });
    expect(getPlayer(ctx, 'u1')!.location).toBe('pond');
  });

  it('abandoned sessions expire after sessionTtlMs', () => {
    const ctx = createTestContext();
    startCast(ctx, 'u1', { forceOutcome: fish(COMMON) });
    ctx.clock.advance(BALANCE.fishing.sessionTtlMs + 1);
    expect(startCast(ctx, 'u1', { forceOutcome: fish(COMMON) }).ok).toBe(true);
  });

  it('refuses without energy and reports the wait time', () => {
    const ctx = createTestContext();
    startCast(ctx, 'u1', { forceOutcome: fish(COMMON) });
    clearSessions();
    setEnergy(ctx, 'u1', 5, ctx.clock.now());
    const r = startCast(ctx, 'u1');
    expect(r).toEqual({ ok: false, error: { code: 'no_energy', energy: 5, cost: 8, msUntil: 3 * BALANCE.energy.regenMsPerPoint } });
    ctx.clock.advance(3 * BALANCE.energy.regenMsPerPoint);
    expect(startCast(ctx, 'u1', { forceOutcome: fish(COMMON) }).ok).toBe(true);
  });

  it('full cage blocks /fish', () => {
    const ctx = createTestContext();
    startCast(ctx, 'u1', { forceOutcome: fish(COMMON) });
    clearSessions();
    const cap = getPlayer(ctx, 'u1')!.cage_capacity;
    expect(cap).toBe(BALANCE.cage.baseCapacity);
    for (let n = 0; n < cap; n++) addCaughtFish(ctx, { userId: 'u1', speciesId: COMMON.id, weight: 1, quality: 1, value: 1, location: 'pond', caughtAt: 0 });
    expect(startCast(ctx, 'u1')).toEqual({ ok: false, error: { code: 'cage_full', count: cap, capacity: cap } });
  });

  it('locked location is refused', () => {
    const ctx = createTestContext();
    const r = startCast(ctx, 'u1', { location: 'deep' });
    expect(r).toMatchObject({ ok: false, error: { code: 'locked', level: 1 } });
    expect(energy(ctx)).toBe(BALANCE.energy.max);
  });

  it('bait is consumed per cast; bite hour is read from server_events', () => {
    const ctx = createTestContext();
    const bait = CONSUMABLES.find((c) => c.kind === 'bait')!;
    startCast(ctx, 'u1', { forceOutcome: fish(COMMON) });
    clearSessions();
    addConsumable(ctx, 'u1', bait.id, 1);
    expect(useItem(ctx, 'u1', bait.id)).toMatchObject({ ok: true, kind: 'bait', castsLeft: bait.bait!.casts });
    const r = startCast(ctx, 'u1', { forceOutcome: fish(COMMON) });
    expect(r.ok && r.bait?.castsLeft).toBe(bait.bait!.casts - 1);
    expect(getActiveBait(ctx, 'u1')!.casts_left).toBe(bait.bait!.casts - 1);

    const now = ctx.clock.now();
    expect(isBiteHour(ctx, now)).toBe(false);
    ctx.db.prepare("INSERT INTO server_events (type, starts_at, ends_at, status) VALUES ('bite_hour', ?, ?, 'active')").run(now - 1000, now + 3600_000);
    expect(isBiteHour(ctx, now)).toBe(true);
    expect(isBiteHour(ctx, now + 3600_000)).toBe(false);
  });
});

describe('hook', () => {
  it('late press → «Сорвалась», refund 4 energy, fish_escaped', () => {
    const ctx = createTestContext();
    const ev = collect(ctx);
    const s = castAndBite(ctx, fish(COMMON));
    const step = pressHook(ctx, s.id, ctx.clock.now() + s.window.totalMs + 1);
    expect(step).toMatchObject({ kind: 'escaped', reason: 'late', refund: 4 });
    expect(energy(ctx)).toBeCloseTo(BALANCE.energy.max - 4);
    expect(ev.at(-1)).toEqual({ type: 'fish_escaped', userId: 'u1', reason: 'late' });
    expect(getSession('u1')).toBeUndefined();
    expect(countCaughtFish(ctx, 'u1')).toBe(0);
  });

  it('timeout without press behaves like late; a second resolution is ignored', () => {
    const ctx = createTestContext();
    const s = castAndBite(ctx, fish(COMMON));
    expect(hookTimeout(ctx, s.id, ctx.clock.now() + 5000)).toMatchObject({ kind: 'escaped', reason: 'late' });
    expect(pressHook(ctx, s.id, ctx.clock.now())).toEqual({ kind: 'invalid' });
  });

  it('press before the bite is shown is invalid', () => {
    const ctx = createTestContext();
    const r = startCast(ctx, 'u1', { forceOutcome: fish(COMMON) });
    expect(r.ok && pressHook(ctx, r.session.id, ctx.clock.now())).toEqual({ kind: 'invalid' });
  });

  it('perfect press: +1★, +10% weight, fish stored with formula value, XP, collection & record', () => {
    const ctx = createTestContext();
    const ev = collect(ctx);
    const s = castAndBite(ctx, fish(COMMON, 1));
    const step = pressHook(ctx, s.id, ctx.clock.now() + 10) as Extract<FishingStep, { kind: 'caught' }>;
    expect(step.kind).toBe('caught');
    const r = step.result;
    expect(r.perfect).toBe(true);
    expect(r.weight).toBe(1.1);
    expect(r.quality).toBeGreaterThanOrEqual(2);
    const avg = (COMMON.minWeight + COMMON.maxWeight) / 2;
    expect(r.value).toBe(Math.max(1, Math.round(COMMON.basePrice * (1.1 / avg) * BALANCE.fishing.qualityMultipliers[r.quality - 1]!)));
    const row = ctx.db.prepare('SELECT * FROM caught_fish WHERE id = ?').get(r.fishId) as { value: number; weight: number };
    expect(row).toMatchObject({ value: r.value, weight: 1.1 });
    expect(getPlayer(ctx, 'u1')!.xp).toBe(BALANCE.fishing.xpByRarity.common);
    expect(listCollection(ctx, 'u1')).toMatchObject([{ species_id: COMMON.id, count: 1, best_weight: 1.1 }]);
    expect(r.record).toBe(true);
    expect(getSpeciesRecord(ctx, COMMON.id)).toMatchObject({ user_id: 'u1', weight: 1.1 });
    expect(ev.at(-1)).toEqual({
      type: 'fish_caught',
      userId: 'u1',
      speciesId: COMMON.id,
      rarity: 'common',
      weight: 1.1,
      quality: r.quality,
      perfect: true,
      location: 'pond',
      value: r.value,
      firstOfSpecies: true,
      seasonal: false,
    });
  });

  it('first-catch pearls are granted exactly once per species', () => {
    const ctx = createTestContext();
    const p = BALANCE.firstCatchPearls.common;
    for (let n = 0; n < 3; n++) {
      const s = castAndBite(ctx, fish(COMMON));
      const step = pressHook(ctx, s.id, ctx.clock.now() + 1500) as Extract<FishingStep, { kind: 'caught' }>;
      expect(step.result.firstOfSpecies).toBe(n === 0);
      expect(step.result.pearls).toBe(n === 0 ? p : 0);
      expect(step.result.perfect).toBe(false);
    }
    expect(getBalance(ctx, 'u1').pearls).toBe(p);
    expect(listCollection(ctx, 'u1')[0]!.count).toBe(3);
  });

  it('species record only moves for heavier fish', () => {
    const ctx = createTestContext();
    const catchW = (u: string, w: number) => {
      const s = castAndBite(ctx, fish(COMMON, w), u);
      return (pressHook(ctx, s.id, ctx.clock.now() + 1500) as Extract<FishingStep, { kind: 'caught' }>).result.record;
    };
    expect(catchW('u1', 1)).toBe(true);
    expect(catchW('u2', 0.5)).toBe(false);
    expect(catchW('u2', 1.2)).toBe(true);
    expect(getSpeciesRecord(ctx, COMMON.id)).toMatchObject({ user_id: 'u2', weight: 1.2 });
  });

  it('heavy fish over the line limit that snaps → escape "line" with refund', () => {
    const ctx = createTestContext();
    const ev = collect(ctx);
    const s = castAndBite(ctx, fish(COMMON, 99, true));
    expect(pressHook(ctx, s.id, ctx.clock.now() + 100)).toMatchObject({ kind: 'escaped', reason: 'line', refund: 4 });
    expect(ev.at(-1)).toEqual({ type: 'fish_escaped', userId: 'u1', reason: 'line' });
  });

  it('junk and treasure resolve on hook press', () => {
    const ctx = createTestContext();
    const ev = collect(ctx);
    let s = castAndBite(ctx, { kind: 'junk', item: { id: 'boot', name: 'Ботинок', emoji: '🥾', coins: 2 } });
    expect(pressHook(ctx, s.id, ctx.clock.now() + 100)).toMatchObject({ kind: 'junk', coins: 2 });
    s = castAndBite(ctx, { kind: 'treasure', coins: 0, pearls: 2 });
    expect(pressHook(ctx, s.id, ctx.clock.now() + 100)).toMatchObject({ kind: 'treasure', pearls: 2 });
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 2, pearls: 2 });
    expect(ev.filter((e) => e.type === 'junk_caught' || e.type === 'treasure_found')).toHaveLength(2);
  });
});

describe('reel', () => {
  function toReel(ctx: TestContext, species: FishSpecies) {
    const s = castAndBite(ctx, fish(species, species.minWeight));
    const step = pressHook(ctx, s.id, ctx.clock.now() + 1500);
    expect(step.kind).toBe('reel');
    return { s, step: step as Extract<FishingStep, { kind: 'reel' }> };
  }

  it('rare fish: 2 rounds of correct presses → caught; 1 mistake lowers quality', () => {
    const ctx = createTestContext();
    const { s, step } = toReel(ctx, RARE);
    expect(step.rounds).toBe(2);
    expect(step.escapeAt).toBe(2);
    startReelRound(s.id, ctx.clock.now());
    const wrong = (['left', 'up', 'right'] as const).find((d) => d !== step.target)!;
    const r1 = pressReel(ctx, s.id, 0, wrong, ctx.clock.now() + 500);
    expect(r1).toMatchObject({ kind: 'reel', round: 2, mistakes: 1, last: 'miss' });
    const t2 = (r1 as Extract<FishingStep, { kind: 'reel' }>).target;
    startReelRound(s.id, ctx.clock.now());
    expect(pressReel(ctx, s.id, 0, t2, ctx.clock.now())).toEqual({ kind: 'invalid' }); // stale round button
    const done = pressReel(ctx, s.id, 1, t2, ctx.clock.now() + 500) as Extract<FishingStep, { kind: 'caught' }>;
    expect(done.kind).toBe('caught');
    expect(done.result.mistakes).toBe(1);
    expect(done.result.pearls).toBe(BALANCE.firstCatchPearls.rare);
  });

  it('epic fish: 3 rounds; two timeouts → fish escapes (reason reel) with refund', () => {
    const ctx = createTestContext();
    const ev = collect(ctx);
    const { s, step } = toReel(ctx, EPIC);
    expect(step.rounds).toBe(3);
    startReelRound(s.id, ctx.clock.now());
    expect(pressReel(ctx, s.id, 0, null, ctx.clock.now() + 4000)).toMatchObject({ kind: 'reel', mistakes: 1 });
    startReelRound(s.id, ctx.clock.now());
    expect(pressReel(ctx, s.id, 1, null, ctx.clock.now() + 4000)).toMatchObject({ kind: 'escaped', reason: 'reel', refund: 4 });
    expect(ev.at(-1)).toEqual({ type: 'fish_escaped', userId: 'u1', reason: 'reel' });
    expect(countCaughtFish(ctx, 'u1')).toBe(0);
  });

  it('slow but correct press counts as a mistake', () => {
    const ctx = createTestContext();
    const { s, step } = toReel(ctx, RARE);
    startReelRound(s.id, ctx.clock.now());
    const late = ctx.clock.now() + step.roundTimeMs + BALANCE.fishing.latencyGraceMs + 1;
    expect(pressReel(ctx, s.id, 0, step.target, late)).toMatchObject({ kind: 'reel', mistakes: 1 });
  });
});

describe('timers', () => {
  it('scheduleSession uses injectable timers and is cleared when the session ends', () => {
    const ctx = createTestContext();
    const pending = new Map<number, () => void>();
    let id = 0;
    setFishingTimers({ setTimeout: (fn) => (pending.set(++id, fn), id), clearTimeout: (h) => void pending.delete(h as number) });
    const r = startCast(ctx, 'u1', { forceOutcome: fish(COMMON) });
    if (!r.ok) throw new Error('cast');
    let fired = 0;
    scheduleSession(r.session.id, 1000, () => fired++);
    expect(pending.size).toBe(1);
    markBiteShown(r.session.id, ctx.clock.now());
    pressHook(ctx, r.session.id, ctx.clock.now() + 100);
    expect(pending.size).toBe(0);
    expect(fired).toBe(0);
  });
});
