import { describe, expect, it } from 'vitest';
import { InsufficientFundsError, addCoins, addPearls, getBalance, spendCoins, spendPearls } from '../../src/db/repos/wallet.js';
import { InsufficientItemsError, addConsumable, removeConsumable, getConsumableQty } from '../../src/db/repos/inventory.js';
import { createTestContext, seedPlayer } from '../helpers.js';

describe('wallet', () => {
  it('adds and spends', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    expect(addCoins(ctx, 'u1', 100)).toBe(100);
    expect(spendCoins(ctx, 'u1', 40)).toBe(60);
    expect(addPearls(ctx, 'u1', 10)).toBe(10);
    expect(spendPearls(ctx, 'u1', 10)).toBe(0);
  });

  it('cannot go negative (typed error, nothing changed)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 50, pearls: 5 });
    expect(() => spendCoins(ctx, 'u1', 51)).toThrow(InsufficientFundsError);
    try {
      spendPearls(ctx, 'u1', 6);
    } catch (e) {
      expect(e).toBeInstanceOf(InsufficientFundsError);
      expect((e as InsufficientFundsError).currency).toBe('pearls');
      expect((e as InsufficientFundsError).available).toBe(5);
    }
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 50, pearls: 5 });
  });

  it('rolls back the whole caller transaction on insufficient funds', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 30 });
    const tx = ctx.db.transaction(() => {
      addPearls(ctx, 'u1', 10);
      spendCoins(ctx, 'u1', 20);
      spendCoins(ctx, 'u1', 20); // fails → everything rolls back
    });
    expect(() => tx()).toThrow(InsufficientFundsError);
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 30, pearls: 0 });
  });

  it('rejects negative / fractional amounts and unknown players', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 10 });
    expect(() => addCoins(ctx, 'u1', -5)).toThrow();
    expect(() => spendCoins(ctx, 'u1', 1.5)).toThrow();
    expect(() => addCoins(ctx, 'ghost', 5)).toThrow(/not found/);
  });

  it('consumables cannot go negative', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    addConsumable(ctx, 'u1', 'energy_drink', 2);
    expect(removeConsumable(ctx, 'u1', 'energy_drink', 1)).toBe(1);
    expect(() => removeConsumable(ctx, 'u1', 'energy_drink', 2)).toThrow(InsufficientItemsError);
    expect(removeConsumable(ctx, 'u1', 'energy_drink', 1)).toBe(0);
    expect(getConsumableQty(ctx, 'u1', 'energy_drink')).toBe(0);
  });
});
