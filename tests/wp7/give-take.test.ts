import { describe, expect, it } from 'vitest';
import { createTestContext, seedPlayer } from '../helpers.js';
import { AdminError, giveReward, takeCurrency } from '../../src/services/admin.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { getConsumableQty, hasGear, hasCosmetic } from '../../src/db/repos/inventory.js';
import { CONSUMABLES } from '../../src/data/consumables.js';
import { GEAR } from '../../src/data/gear.js';
import { COSMETICS } from '../../src/data/cosmetics.js';
import { listAudit } from '../../src/db/repos/audit.js';

const ITEM_ID = CONSUMABLES[0]!.id;
const GEAR_ID = GEAR[0]!.id;
const COSMETIC_ID = COSMETICS[0]!.id;

describe('services/admin giveReward', () => {
  it('grants coins and writes an audit row', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const res = giveReward(ctx, 'actor', 'u1', 'coins', undefined, 500);
    expect(getBalance(ctx, 'u1').coins).toBe(500);
    expect(res.summary).toContain('🪙');
    const audit = listAudit(ctx, 1)[0]!;
    expect(audit.action).toBe('admin:give');
    expect(JSON.parse(audit.details ?? '{}')).toMatchObject({ targetId: 'u1', kind: 'coins', qty: 500 });
  });

  it('grants pearls, items, gear and cosmetics', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    giveReward(ctx, 'actor', 'u1', 'pearls', undefined, 7);
    expect(getBalance(ctx, 'u1').pearls).toBe(7);
    giveReward(ctx, 'actor', 'u1', 'item', ITEM_ID, 3);
    expect(getConsumableQty(ctx, 'u1', ITEM_ID)).toBe(3);
    giveReward(ctx, 'actor', 'u1', 'gear', GEAR_ID, 1);
    expect(hasGear(ctx, 'u1', GEAR_ID)).toBe(true);
    giveReward(ctx, 'actor', 'u1', 'cosmetic', COSMETIC_ID, 1);
    expect(hasCosmetic(ctx, 'u1', COSMETIC_ID)).toBe(true);
  });

  it('rejects unknown item/gear/cosmetic ids', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    expect(() => giveReward(ctx, 'actor', 'u1', 'item', 'nope', 1)).toThrow(AdminError);
    expect(() => giveReward(ctx, 'actor', 'u1', 'gear', 'nope', 1)).toThrow(AdminError);
    expect(() => giveReward(ctx, 'actor', 'u1', 'cosmetic', 'nope', 1)).toThrow(AdminError);
    expect(() => giveReward(ctx, 'actor', 'u1', 'item', undefined, 1)).toThrow(AdminError);
  });

  it('validates qty ranges (1..1_000_000 currency, 1..100 items)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    expect(() => giveReward(ctx, 'actor', 'u1', 'coins', undefined, 0)).toThrow(AdminError);
    expect(() => giveReward(ctx, 'actor', 'u1', 'coins', undefined, 1_000_001)).toThrow(AdminError);
    expect(() => giveReward(ctx, 'actor', 'u1', 'item', ITEM_ID, 0)).toThrow(AdminError);
    expect(() => giveReward(ctx, 'actor', 'u1', 'item', ITEM_ID, 101)).toThrow(AdminError);
    expect(() => giveReward(ctx, 'actor', 'u1', 'item', ITEM_ID, 1.5)).toThrow(AdminError);
    // boundaries are accepted
    expect(() => giveReward(ctx, 'actor', 'u1', 'item', ITEM_ID, 100)).not.toThrow();
    expect(() => giveReward(ctx, 'actor', 'u1', 'coins', undefined, 1_000_000)).not.toThrow();
  });
});

describe('services/admin takeCurrency', () => {
  it('subtracts currency and writes an audit row', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 100, pearls: 5 });
    const res = takeCurrency(ctx, 'actor', 'u1', 'coins', 40);
    expect(res).toEqual({ taken: 40, balance: 60 });
    expect(getBalance(ctx, 'u1').coins).toBe(60);
    const audit = listAudit(ctx, 1)[0]!;
    expect(audit.action).toBe('admin:take');
    expect(JSON.parse(audit.details ?? '{}')).toMatchObject({ targetId: 'u1', currency: 'coins', requested: 40, taken: 40 });
  });

  it('clamps the taken amount to the current balance', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 10, pearls: 2 });
    const res = takeCurrency(ctx, 'actor', 'u1', 'pearls', 999);
    expect(res).toEqual({ taken: 2, balance: 0 });
    expect(getBalance(ctx, 'u1').pearls).toBe(0);
  });

  it('rejects non-positive or non-integer qty', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 10 });
    expect(() => takeCurrency(ctx, 'actor', 'u1', 'coins', 0)).toThrow(AdminError);
    expect(() => takeCurrency(ctx, 'actor', 'u1', 'coins', -5)).toThrow(AdminError);
    expect(() => takeCurrency(ctx, 'actor', 'u1', 'coins', 1.5)).toThrow(AdminError);
  });
});
