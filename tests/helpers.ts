// Shared test helpers (any WP may use them).
import { FakeClock } from '../src/core/clock.js';
import { createContext, type GameContext } from '../src/core/context.js';
import { seededRng } from '../src/core/rng.js';
import { openDatabase } from '../src/db/database.js';
import { getOrCreatePlayer } from '../src/services/player.js';

export interface TestContext extends GameContext {
  clock: FakeClock;
}

/** Fresh in-memory migrated DB, seeded rng, fake clock (default 2026-01-05 12:00 Moscow, a Monday). */
export function createTestContext(opts: { seed?: number; now?: number; timezone?: string } = {}): TestContext {
  const db = openDatabase(':memory:');
  const clock = new FakeClock(opts.now ?? Date.UTC(2026, 0, 5, 9, 0, 0));
  const ctx = createContext({ db, rng: seededRng(opts.seed ?? 42), clock, defaultTimezone: opts.timezone ?? 'Europe/Moscow' });
  return ctx as TestContext;
}

/** Creates a player with optional starting balances. */
export function seedPlayer(ctx: GameContext, userId = 'u1', balances: { coins?: number; pearls?: number } = {}): void {
  getOrCreatePlayer(ctx, userId, `user-${userId}`);
  if (balances.coins || balances.pearls) {
    ctx.db.prepare('UPDATE players SET coins = ?, pearls = ? WHERE user_id = ?').run(balances.coins ?? 0, balances.pearls ?? 0, userId);
  }
}
