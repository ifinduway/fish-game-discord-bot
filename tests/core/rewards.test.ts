import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { getConsumableQty, hasCosmetic, listCosmetics, listGearItems } from '../../src/db/repos/inventory.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { formatReward, grantReward, mergeRewards, registerPassXpHandler } from '../../src/services/rewards.js';
import { getPlayer } from '../../src/db/repos/players.js';
import { GEAR } from '../../src/data/gear.js';
import { CONSUMABLES } from '../../src/data/consumables.js';
import { COSMETICS } from '../../src/data/cosmetics.js';
import { createTestContext, seedPlayer } from '../helpers.js';

// derive ids from the catalogs so the test survives WP1 replacing the data
const GEAR0 = GEAR[0]!;
const ITEM0 = CONSUMABLES[0]!;
const COSM0 = COSMETICS[0]!;

describe('grantReward', () => {
  afterEach(() => registerPassXpHandler(null));

  it('grants coins, pearls, items, gear and cosmetics', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const { summary } = grantReward(
      ctx,
      'u1',
      { coins: 120, pearls: 5, items: [{ itemId: ITEM0.id, qty: 2 }], gear: [GEAR0.id], cosmetics: [COSM0.id] },
      'test',
    );
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 120, pearls: 5 });
    expect(getConsumableQty(ctx, 'u1', ITEM0.id)).toBe(2);
    expect(listGearItems(ctx, 'u1').map((g) => g.gear_id)).toEqual([GEAR0.id]);
    expect(hasCosmetic(ctx, 'u1', COSM0.id)).toBe(true);
    expect(summary).toContain('🪙 120');
    expect(summary).toContain('🐚 5');
    expect(summary).toContain(`${ITEM0.name} ×2`);
  });

  it('creates the player if missing', () => {
    const ctx = createTestContext();
    grantReward(ctx, 'new', { pearls: 3 }, 'test');
    expect(getBalance(ctx, 'new').pearls).toBe(3);
  });

  it('converts duplicate gear to coins and ignores duplicate cosmetics', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    grantReward(ctx, 'u1', { gear: [GEAR0.id], cosmetics: [COSM0.id] }, 'a');
    const { summary } = grantReward(ctx, 'u1', { gear: [GEAR0.id], cosmetics: [COSM0.id] }, 'b');
    expect(listGearItems(ctx, 'u1')).toHaveLength(1);
    expect(listCosmetics(ctx, 'u1')).toHaveLength(1);
    expect(getBalance(ctx, 'u1').coins).toBe(BALANCE.gearDuplicateCoins[GEAR0.tier]);
    expect(summary).toContain('дубль');
  });

  it('grants xp with level-up notices and calls the pass xp handler', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const calls: [string, number, string][] = [];
    registerPassXpHandler((_c, userId, amount, source) => {
      calls.push([userId, amount, source]);
      return [{ userId, text: 'pass!' }];
    });
    const { notices } = grantReward(ctx, 'u1', { xp: 10_000, passXp: 20 }, 'challenge');
    expect(getPlayer(ctx, 'u1')!.level).toBeGreaterThan(1);
    expect(calls).toEqual([['u1', 20, 'challenge']]);
    expect(notices.some((n) => n.text.includes('Новый уровень'))).toBe(true);
    expect(notices.some((n) => n.text === 'pass!')).toBe(true);
  });

  it('is atomic: unknown ids roll back everything', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    expect(() => grantReward(ctx, 'u1', { coins: 100, gear: ['no_such_gear'] }, 'x')).toThrow();
    expect(getBalance(ctx, 'u1').coins).toBe(0);
  });

  it('formatReward / mergeRewards', () => {
    expect(formatReward({ coins: 120, pearls: 5, items: [{ itemId: ITEM0.id, qty: 1 }] })).toBe(`🪙 120 · 🐚 5 · ${ITEM0.emoji} ${ITEM0.name} ×1`);
    expect(formatReward({})).toBe('ничего');
    expect(mergeRewards({ coins: 1, gear: ['a'] }, { coins: 2, pearls: 3, gear: ['b'] })).toEqual({ coins: 3, pearls: 3, gear: ['a', 'b'] });
  });
});
