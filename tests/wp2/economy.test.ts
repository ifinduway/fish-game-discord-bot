import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { GameEvent } from '../../src/core/events.js';
import { FISH } from '../../src/data/fish.js';
import { SHOP_LISTINGS } from '../../src/data/shop.js';
import { addCaughtFish, countCaughtFish, getConsumableQty, setFishStaked } from '../../src/db/repos/inventory.js';
import { getPlayer } from '../../src/db/repos/players.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { cageUpgradeCost, dailyReward, discounted, fishValue, qualityMultiplier } from '../../src/game/economy.js';
import { claimDaily, sellFish } from '../../src/services/economy.js';
import { clearSessions } from '../../src/services/fishing.js';
import { basePrice, buy, dailyOffer, shopEntries } from '../../src/services/shop.js';
import { createTestContext, seedPlayer, type TestContext } from '../helpers.js';

afterEach(() => clearSessions());

const DAY = 24 * 3600_000;
const COMMON = FISH.find((f) => f.rarity === 'common')!;
const RARE = FISH.find((f) => f.rarity === 'rare')!;

function addFish(ctx: TestContext, userId: string, speciesId: string, value: number): number {
  return addCaughtFish(ctx, { userId, speciesId, weight: 1, quality: 1, value, location: 'pond', caughtAt: ctx.clock.now() });
}

describe('price formula', () => {
  it('value = base × (weight / avg) × quality multiplier', () => {
    const s = { basePrice: 100, minWeight: 1, maxWeight: 3 };
    expect(fishValue(s, 2, 1)).toBe(100);
    expect(fishValue(s, 4, 1)).toBe(200);
    expect(fishValue(s, 2, 3)).toBe(150);
    expect(fishValue(s, 3, 5)).toBe(Math.round(100 * 1.5 * 3));
    expect(fishValue(s, 0.001, 1)).toBe(1);
    expect([1, 2, 3, 4, 5].map(qualityMultiplier)).toEqual(BALANCE.fishing.qualityMultipliers);
  });
});

describe('selling', () => {
  it('sells all/rarity/single fish, pays stored values, emits fish_sold', () => {
    const ctx = createTestContext();
    const sold: GameEvent[] = [];
    ctx.bus.on('fish_sold', (e) => void sold.push(e));
    seedPlayer(ctx, 'u1');
    const a = addFish(ctx, 'u1', COMMON.id, 10);
    addFish(ctx, 'u1', COMMON.id, 15);
    addFish(ctx, 'u1', RARE.id, 100);
    expect(sellFish(ctx, 'u1', { kind: 'fish', fishId: a })).toMatchObject({ count: 1, coins: 10 });
    expect(sellFish(ctx, 'u1', { kind: 'rarity', rarity: 'rare' })).toMatchObject({ count: 1, coins: 100 });
    expect(sellFish(ctx, 'u1', { kind: 'all' })).toMatchObject({ count: 1, coins: 15 });
    expect(sellFish(ctx, 'u1', { kind: 'all' })).toMatchObject({ count: 0, coins: 0 });
    expect(getBalance(ctx, 'u1').coins).toBe(125);
    expect(sold).toEqual([
      { type: 'fish_sold', userId: 'u1', count: 1, coins: 10 },
      { type: 'fish_sold', userId: 'u1', count: 1, coins: 100 },
      { type: 'fish_sold', userId: 'u1', count: 1, coins: 15 },
    ]);
  });

  it('never sells staked fish or fish of another player', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    seedPlayer(ctx, 'u2');
    const staked = addFish(ctx, 'u1', COMMON.id, 50);
    addFish(ctx, 'u1', COMMON.id, 5);
    const other = addFish(ctx, 'u2', COMMON.id, 70);
    setFishStaked(ctx, 'u1', [staked], true);
    expect(sellFish(ctx, 'u1', { kind: 'fish', fishId: staked }).count).toBe(0);
    expect(sellFish(ctx, 'u1', { kind: 'fish', fishId: other }).count).toBe(0);
    expect(sellFish(ctx, 'u1', { kind: 'all' })).toMatchObject({ count: 1, coins: 5 });
    expect(countCaughtFish(ctx, 'u1', true)).toBe(1);
    expect(getBalance(ctx, 'u2').coins).toBe(0);
  });
});

describe('daily', () => {
  it('pure: streak grows by consecutive days, resets on a missed day, max 10 pearls', () => {
    expect(dailyReward(null, 0, '2026-01-05', '2026-01-04')).toEqual({ ok: true, streak: 1, pearls: 3 });
    expect(dailyReward('2026-01-04', 1, '2026-01-05', '2026-01-04')).toEqual({ ok: true, streak: 2, pearls: 4 });
    expect(dailyReward('2026-01-03', 5, '2026-01-05', '2026-01-04')).toEqual({ ok: true, streak: 1, pearls: 3 });
    expect(dailyReward('2026-01-05', 5, '2026-01-05', '2026-01-04')).toEqual({ ok: false, reason: 'already_claimed' });
    expect(dailyReward('2026-01-04', 30, '2026-01-05', '2026-01-04')).toMatchObject({ pearls: 10 });
  });

  it('service: once per server-tz day, streak & reset, pearls credited', () => {
    const ctx = createTestContext();
    const events: GameEvent[] = [];
    ctx.bus.on('daily_claimed', (e) => void events.push(e));
    const expected = [3, 4, 5, 6, 7, 8, 9, 10, 10];
    let total = 0;
    for (const p of expected) {
      const r = claimDaily(ctx, 'u1');
      expect(r).toMatchObject({ ok: true, pearls: p });
      total += p;
      expect(claimDaily(ctx, 'u1')).toMatchObject({ ok: false, reason: 'already_claimed' });
      ctx.clock.advance(DAY);
    }
    expect(getBalance(ctx, 'u1').pearls).toBe(total);
    ctx.clock.advance(DAY); // missed a day
    expect(claimDaily(ctx, 'u1')).toMatchObject({ ok: true, streak: 1, pearls: 3 });
    expect(events).toHaveLength(expected.length + 1);
  });

  it('day boundary is local midnight (Europe/Moscow)', () => {
    const ctx = createTestContext({ now: Date.UTC(2026, 0, 5, 20, 59, 0) }); // 23:59 MSK
    expect(claimDaily(ctx, 'u1').ok).toBe(true);
    ctx.clock.advance(2 * 60_000); // 00:01 MSK next day
    expect(claimDaily(ctx, 'u1')).toMatchObject({ ok: true, streak: 2 });
  });
});

describe('shop', () => {
  it('buys consumables with qty, gear once, respects level gates and funds (no negative money)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const cons = SHOP_LISTINGS.find((l) => l.kind === 'consumable' && l.unlockLevel <= 1)!;
    const offer = dailyOffer(ctx);
    const price = offer?.id === cons.id ? discounted(basePrice(cons)!) : basePrice(cons)!;
    const r = buy(ctx, 'u1', cons.id, 2);
    expect(r).toMatchObject({ ok: true, spent: price * 2 });
    expect(getConsumableQty(ctx, 'u1', cons.refId!)).toBe(2);

    const gated = SHOP_LISTINGS.find((l) => l.unlockLevel > 1)!;
    expect(buy(ctx, 'u1', gated.id)).toMatchObject({ ok: false, reason: 'level' });
    // starter gear is already owned
    const starter = SHOP_LISTINGS.find((l) => l.kind === 'gear' && l.unlockLevel <= 1 && shopEntries(ctx, 'u1').find((e) => e.listing.id === l.id)?.owned)!;
    expect(buy(ctx, 'u1', starter.id)).toMatchObject({ ok: false, reason: 'owned' });

    const coinsBefore = getBalance(ctx, 'u1').coins;
    const r2 = buy(ctx, 'u1', cons.id, BALANCE.shop.maxBuyQty);
    if (price * BALANCE.shop.maxBuyQty > coinsBefore) {
      expect(r2).toMatchObject({ ok: false, reason: 'funds', available: coinsBefore });
      expect(getBalance(ctx, 'u1').coins).toBe(coinsBefore);
    }
    expect(buy(ctx, 'u1', 'nope')).toEqual({ ok: false, reason: 'unknown' });
    expect(getBalance(ctx, 'u1').coins).toBeGreaterThanOrEqual(0);
  });

  it('money never goes negative across repeated buys, upgrades and sells', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 777 });
    const cons = SHOP_LISTINGS.find((l) => l.kind === 'consumable' && l.unlockLevel <= 1)!;
    let ok = 0;
    for (let n = 0; n < 100; n++) {
      const r = n % 3 === 0 ? buy(ctx, 'u1', SHOP_LISTINGS.find((l) => l.kind === 'cage')!.id) : buy(ctx, 'u1', cons.id, 3);
      if (r.ok) ok++;
      expect(getBalance(ctx, 'u1').coins).toBeGreaterThanOrEqual(0);
    }
    expect(ok).toBeGreaterThan(0);
    expect(buy(ctx, 'u1', cons.id, 3)).toMatchObject({ ok: false, reason: 'funds' });
  });

  it('cage upgrade: +25 capacity, price doubles, max 200', () => {
    const ctx = createTestContext();
    const C = BALANCE.cage;
    seedPlayer(ctx, 'u1', { coins: 1_000_000 });
    const cage = SHOP_LISTINGS.find((l) => l.kind === 'cage')!;
    const events: GameEvent[] = [];
    ctx.bus.on('coins_spent', (e) => void events.push(e));
    let expectedCost = C.upgradeBaseCost;
    for (let cap = C.baseCapacity; cap < C.maxCapacity; cap += C.upgradeStep) {
      expect(cageUpgradeCost(cap)).toBe(expectedCost);
      expect(buy(ctx, 'u1', cage.id)).toMatchObject({ ok: true, spent: expectedCost });
      expect(getPlayer(ctx, 'u1')!.cage_capacity).toBe(cap + C.upgradeStep);
      expectedCost *= 2;
    }
    expect(buy(ctx, 'u1', cage.id)).toMatchObject({ ok: false, reason: 'maxed' });
    expect(events.length).toBe((C.maxCapacity - C.baseCapacity) / C.upgradeStep);
  });

  it('daily offer is deterministic per day and discounted', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const a = dailyOffer(ctx);
    expect(dailyOffer(ctx)).toEqual(a);
    const e = shopEntries(ctx, 'u1').find((x) => x.isOffer)!;
    expect(e.price).toBe(discounted(e.basePrice!));
    expect(e.price!).toBeLessThan(e.basePrice!);
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) {
      seen.add(dailyOffer(ctx)!.id);
      ctx.clock.advance(DAY);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
