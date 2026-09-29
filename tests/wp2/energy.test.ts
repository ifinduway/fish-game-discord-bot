import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { GEAR } from '../../src/data/gear.js';
import { CONSUMABLES } from '../../src/data/consumables.js';
import { addConsumable } from '../../src/db/repos/inventory.js';
import { setEnergy } from '../../src/db/repos/players.js';
import {
  applyDrink,
  applyRefund,
  castCostFor,
  currentEnergy,
  energyParams,
  escapeRefund,
  maxEnergyFor,
  msToFull,
  msUntil,
  regenMsFor,
  spend,
} from '../../src/game/energy.js';
import { aggregateStats } from '../../src/game/gear-stats.js';
import { useItem } from '../../src/services/economy.js';
import { clearSessions } from '../../src/services/fishing.js';
import { ensurePlayerReady, getPlayerState } from '../../src/services/player-state.js';
import { createTestContext } from '../helpers.js';

const E = BALANCE.energy;
const BASE = { max: 100, regenMsPerPoint: E.regenMsPerPoint };
const DRINK = CONSUMABLES.find((c) => c.kind === 'energy')!;

afterEach(() => clearSessions());

describe('energy regen (pure)', () => {
  it('regenerates 1 point per 2.4 minutes', () => {
    expect(E.regenMsPerPoint).toBe(144_000);
    expect(currentEnergy(0, 0, 144_000, BASE)).toBeCloseTo(1);
    expect(currentEnergy(50, 1000, 1000 + 10 * 144_000, BASE)).toBeCloseTo(60);
  });

  it('0 → 100 takes 4 hours and caps at max', () => {
    expect(currentEnergy(0, 0, 4 * 3600_000, BASE)).toBe(100);
    expect(currentEnergy(0, 0, 10 * 3600_000, BASE)).toBe(100);
    expect(msToFull(0, BASE)).toBe(4 * 3600_000);
  });

  it('overflow (drinks) is kept but never regenerates', () => {
    expect(currentEnergy(130, 0, 3600_000, BASE)).toBe(130);
  });

  it('time until enough energy for a cast', () => {
    expect(msUntil(5, 8, BASE)).toBe(3 * 144_000);
    expect(msUntil(9, 8, BASE)).toBe(0);
  });

  it('cast cost and 50% refund', () => {
    expect(castCostFor({})).toBe(8);
    expect(spend(10, 8)).toBe(2);
    expect(spend(7.5, 8)).toBeNull();
    expect(escapeRefund(8)).toBe(4);
    expect(applyRefund(50, 4, 100)).toBe(54);
    expect(applyRefund(98, 4, 100)).toBe(100);
    expect(applyRefund(120, 4, 100)).toBe(120);
  });

  it('gear changes max energy, cast cost (min 1) and regen speed', () => {
    expect(maxEnergyFor({ maxEnergy: 20 })).toBe(120);
    expect(castCostFor({ castCostReduction: 2 })).toBe(6);
    expect(castCostFor({ castCostReduction: 50 })).toBe(E.minCastCost);
    expect(regenMsFor({ energyRegenBonus: 0.2 })).toBe(Math.round(144_000 / 1.2));
    expect(energyParams({ maxEnergy: 10 }).max).toBe(110);
  });
});

describe('energy drinks (pure)', () => {
  it('adds 30 up to 150% of max, max 3 per day', () => {
    expect(applyDrink(50, 100, 0)).toEqual({ ok: true, energy: 80, gained: 30, drinksUsed: 1 });
    expect(applyDrink(140, 100, 1)).toEqual({ ok: true, energy: 150, gained: 10, drinksUsed: 2 });
    expect(applyDrink(150, 100, 2)).toEqual({ ok: false, reason: 'full' });
    expect(applyDrink(10, 100, 3)).toEqual({ ok: false, reason: 'limit' });
  });
});

describe('energy via services', () => {
  it('getPlayerState is lazy and read-only', () => {
    const ctx = createTestContext();
    ensurePlayerReady(ctx, 'u1');
    setEnergy(ctx, 'u1', 10, ctx.clock.now());
    ctx.clock.advance(144_000 * 5);
    const before = ctx.db.prepare('SELECT energy, energy_updated_at FROM players WHERE user_id = ?').get('u1');
    const st = getPlayerState(ctx, 'u1');
    expect(st.energy).toBeCloseTo(15);
    expect(ctx.db.prepare('SELECT energy, energy_updated_at FROM players WHERE user_id = ?').get('u1')).toEqual(before);
  });

  it('starter outfit raises max energy', () => {
    const ctx = createTestContext();
    ensurePlayerReady(ctx, 'u1');
    const st = getPlayerState(ctx, 'u1');
    const outfit = st.equipped.find((e) => e.slot === 'outfit');
    expect(outfit).toBeDefined();
    const def = GEAR.find((g) => g.id === outfit!.gearId)!;
    expect(st.maxEnergy).toBe(maxEnergyFor(aggregateStats([{ def, upgrade: 0 }])));
    expect(st.maxEnergy).toBe(100 + (def.stats.maxEnergy ?? 0));
  });

  it('/use drink: limit 3 per server-tz day, resets next day, cap 150%', () => {
    const ctx = createTestContext();
    ensurePlayerReady(ctx, 'u1');
    addConsumable(ctx, 'u1', DRINK.id, 10);
    setEnergy(ctx, 'u1', 0, ctx.clock.now());
    for (let n = 0; n < 3; n++) expect(useItem(ctx, 'u1', DRINK.id).ok).toBe(true);
    expect(useItem(ctx, 'u1', DRINK.id)).toEqual({ ok: false, reason: 'drink_limit' });
    expect(getPlayerState(ctx, 'u1').energy).toBeCloseTo(90);
    ctx.clock.advance(24 * 3600_000);
    const st = getPlayerState(ctx, 'u1');
    const r = useItem(ctx, 'u1', DRINK.id);
    expect(r.ok).toBe(true);
    if (r.ok && r.kind === 'energy') expect(r.energy).toBeCloseTo(Math.min(st.maxEnergy * 1.5, st.energy + 30));
  });

  it('/use drink refuses when energy is already at 150%', () => {
    const ctx = createTestContext();
    ensurePlayerReady(ctx, 'u1');
    addConsumable(ctx, 'u1', DRINK.id, 1);
    const max = getPlayerState(ctx, 'u1').maxEnergy;
    setEnergy(ctx, 'u1', max * 1.5, ctx.clock.now());
    expect(useItem(ctx, 'u1', DRINK.id)).toEqual({ ok: false, reason: 'energy_full' });
    expect(useItem(ctx, 'u2', DRINK.id)).toEqual({ ok: false, reason: 'not_owned' });
  });
});
