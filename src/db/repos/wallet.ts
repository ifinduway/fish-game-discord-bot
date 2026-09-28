// Currency mutations. Every function works inside a caller's transaction (plain statements, no own tx needed:
// each is a single atomic UPDATE). Spends use `WHERE coins >= ?` so balances can never go negative.
import { prepare, type DbCtx } from '../database.js';

export type Currency = 'coins' | 'pearls';

export class InsufficientFundsError extends Error {
  constructor(
    public readonly currency: Currency,
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`Insufficient ${currency}: need ${required}, have ${available}`);
    this.name = 'InsufficientFundsError';
  }
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`Invalid currency amount: ${amount}`);
}

export function getBalance(ctx: DbCtx, userId: string): { coins: number; pearls: number } {
  const row = prepare(ctx.db, 'SELECT coins, pearls FROM players WHERE user_id = ?').get(userId) as { coins: number; pearls: number } | undefined;
  if (!row) throw new Error(`Player not found: ${userId}`);
  return row;
}

function add(ctx: DbCtx, userId: string, currency: Currency, amount: number): number {
  assertAmount(amount);
  const r = prepare(ctx.db, `UPDATE players SET ${currency} = ${currency} + ? WHERE user_id = ?`).run(amount, userId);
  if (r.changes === 0) throw new Error(`Player not found: ${userId}`);
  return getBalance(ctx, userId)[currency];
}

function spend(ctx: DbCtx, userId: string, currency: Currency, amount: number): number {
  assertAmount(amount);
  const r = prepare(ctx.db, `UPDATE players SET ${currency} = ${currency} - ? WHERE user_id = ? AND ${currency} >= ?`).run(amount, userId, amount);
  const bal = getBalance(ctx, userId); // throws if player missing
  if (r.changes === 0) throw new InsufficientFundsError(currency, amount, bal[currency]);
  return bal[currency];
}

/** Returns the new balance. */
export function addCoins(ctx: DbCtx, userId: string, amount: number): number {
  return add(ctx, userId, 'coins', amount);
}
/** Returns the new balance; throws InsufficientFundsError (nothing changed) if not enough. */
export function spendCoins(ctx: DbCtx, userId: string, amount: number): number {
  return spend(ctx, userId, 'coins', amount);
}
export function addPearls(ctx: DbCtx, userId: string, amount: number): number {
  return add(ctx, userId, 'pearls', amount);
}
export function spendPearls(ctx: DbCtx, userId: string, amount: number): number {
  return spend(ctx, userId, 'pearls', amount);
}

/** Admin/reset helper: sets balances directly (must be ≥ 0). */
export function setBalance(ctx: DbCtx, userId: string, balance: { coins?: number; pearls?: number }): void {
  if (balance.coins !== undefined) {
    assertAmount(balance.coins);
    prepare(ctx.db, 'UPDATE players SET coins = ? WHERE user_id = ?').run(balance.coins, userId);
  }
  if (balance.pearls !== undefined) {
    assertAmount(balance.pearls);
    prepare(ctx.db, 'UPDATE players SET pearls = ? WHERE user_id = ?').run(balance.pearls, userId);
  }
}
