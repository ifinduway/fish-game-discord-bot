// Currency mutations. Every function works inside a caller's transaction (plain statements, no own tx needed:
// each is a single atomic UPDATE). Spends use `WHERE coins >= ?` so balances can never go negative.
import { prepare } from '../database.js';
export class InsufficientFundsError extends Error {
    currency;
    required;
    available;
    constructor(currency, required, available) {
        super(`Insufficient ${currency}: need ${required}, have ${available}`);
        this.currency = currency;
        this.required = required;
        this.available = available;
        this.name = 'InsufficientFundsError';
    }
}
function assertAmount(amount) {
    if (!Number.isInteger(amount) || amount < 0)
        throw new Error(`Invalid currency amount: ${amount}`);
}
export function getBalance(ctx, userId) {
    const row = prepare(ctx.db, 'SELECT coins, pearls FROM players WHERE user_id = ?').get(userId);
    if (!row)
        throw new Error(`Player not found: ${userId}`);
    return row;
}
function add(ctx, userId, currency, amount) {
    assertAmount(amount);
    const r = prepare(ctx.db, `UPDATE players SET ${currency} = ${currency} + ? WHERE user_id = ?`).run(amount, userId);
    if (r.changes === 0)
        throw new Error(`Player not found: ${userId}`);
    return getBalance(ctx, userId)[currency];
}
function spend(ctx, userId, currency, amount) {
    assertAmount(amount);
    const r = prepare(ctx.db, `UPDATE players SET ${currency} = ${currency} - ? WHERE user_id = ? AND ${currency} >= ?`).run(amount, userId, amount);
    const bal = getBalance(ctx, userId); // throws if player missing
    if (r.changes === 0)
        throw new InsufficientFundsError(currency, amount, bal[currency]);
    return bal[currency];
}
/** Returns the new balance. */
export function addCoins(ctx, userId, amount) {
    return add(ctx, userId, 'coins', amount);
}
/** Returns the new balance; throws InsufficientFundsError (nothing changed) if not enough. */
export function spendCoins(ctx, userId, amount) {
    return spend(ctx, userId, 'coins', amount);
}
export function addPearls(ctx, userId, amount) {
    return add(ctx, userId, 'pearls', amount);
}
export function spendPearls(ctx, userId, amount) {
    return spend(ctx, userId, 'pearls', amount);
}
/** Admin/reset helper: sets balances directly (must be ≥ 0). */
export function setBalance(ctx, userId, balance) {
    if (balance.coins !== undefined) {
        assertAmount(balance.coins);
        prepare(ctx.db, 'UPDATE players SET coins = ? WHERE user_id = ?').run(balance.coins, userId);
    }
    if (balance.pearls !== undefined) {
        assertAmount(balance.pearls);
        prepare(ctx.db, 'UPDATE players SET pearls = ? WHERE user_id = ?').run(balance.pearls, userId);
    }
}
//# sourceMappingURL=wallet.js.map