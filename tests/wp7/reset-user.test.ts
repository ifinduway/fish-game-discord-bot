// resetUser must remove every row of the target user across all per-user tables (from src/db/migrations.ts),
// while leaving another user's rows and global tables (bosses, server_events, audit_log) untouched.
import { describe, expect, it } from 'vitest';
import { createTestContext, seedPlayer } from '../helpers.js';
import { resetUser } from '../../src/services/admin.js';
import { listAudit } from '../../src/db/repos/audit.js';

/** Inserts one row into every per-user table for userId. Shared global rows (boss/server_event) are created once by the caller. */
function seedFullUser(ctx: ReturnType<typeof createTestContext>, userId: string, bossId: number, eventId: number): void {
  seedPlayer(ctx, userId, { coins: 100, pearls: 10 });
  const now = ctx.clock.now();
  const gearItemId = Number(
    ctx.db.prepare('INSERT INTO gear_items (user_id, gear_id, upgrade, acquired_at) VALUES (?, ?, 0, ?)').run(userId, 'rod_common', now).lastInsertRowid,
  );
  ctx.db.prepare('INSERT INTO equipped (user_id, slot, gear_item_id) VALUES (?, ?, ?)').run(userId, 'rod', gearItemId);
  ctx.db
    .prepare('INSERT INTO caught_fish (user_id, species_id, weight, quality, value, location, caught_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, 'carp', 1.5, 3, 50, 'pond', now);
  ctx.db.prepare('INSERT INTO consumables (user_id, item_id, qty) VALUES (?, ?, ?)').run(userId, 'energy_drink', 2);
  ctx.db.prepare('INSERT INTO active_bait (user_id, item_id, casts_left) VALUES (?, ?, ?)').run(userId, 'worm', 3);
  ctx.db.prepare('INSERT INTO cosmetics (user_id, cosmetic_id, acquired_at, source) VALUES (?, ?, ?, ?)').run(userId, 'title-test', now, 'test');
  ctx.db
    .prepare('INSERT INTO collection (user_id, species_id, first_caught_at, count, best_weight, best_quality) VALUES (?, ?, ?, 1, 1.5, 3)')
    .run(userId, 'carp', now);
  ctx.db.prepare('INSERT INTO stats (user_id, scope, metric, value) VALUES (?, ?, ?, ?)').run(userId, 'all', 'casts', 5);
  ctx.db.prepare('INSERT INTO species_records (species_id, user_id, weight, caught_at) VALUES (?, ?, ?, ?)').run(`carp-${userId}`, userId, 9.9, now);
  ctx.db
    .prepare(
      'INSERT INTO challenges (user_id, scope, period_key, template_id, target, progress) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(userId, 'daily', 'd:2026-01-05', 'tmpl-catch', 5, 1);
  ctx.db.prepare('INSERT INTO challenge_bonuses (user_id, scope, period_key) VALUES (?, ?, ?)').run(userId, 'daily', 'd:2026-01-05');
  ctx.db.prepare('INSERT INTO achievements (user_id, achievement_id, tier, achieved_at) VALUES (?, ?, ?, ?)').run(userId, 'ach-1', 1, now);
  ctx.db.prepare('INSERT INTO season_pass (user_id, season_id, xp, level) VALUES (?, 1, 10, 1)').run(userId);
  ctx.db.prepare('INSERT INTO boss_contributions (boss_id, user_id, damage, hits) VALUES (?, ?, 10, 1)').run(bossId, userId);
  ctx.db.prepare('INSERT INTO tournament_entries (event_id, user_id, best_weight, species_id) VALUES (?, ?, 2.2, ?)').run(eventId, userId, 'carp');
  ctx.db
    .prepare(
      `INSERT INTO blackjack_hands (user_id, stake_type, stake_value, staked_fish, deck, player_cards, dealer_cards, status, created_at, expires_at)
       VALUES (?, 'coins', 10, '[]', '[]', '[]', '[]', 'finished', ?, ?)`,
    )
    .run(userId, now, now + 60_000);
}

const PER_USER_TABLES = [
  'players',
  'gear_items',
  'equipped',
  'caught_fish',
  'consumables',
  'active_bait',
  'cosmetics',
  'collection',
  'stats',
  'species_records',
  'challenges',
  'challenge_bonuses',
  'achievements',
  'season_pass',
  'boss_contributions',
  'tournament_entries',
  'blackjack_hands',
];

function countRows(ctx: ReturnType<typeof createTestContext>, table: string, userId: string): number {
  return (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number }).n;
}

describe('services/admin resetUser', () => {
  it('removes every per-user row for the target and leaves another user + global tables intact', () => {
    const ctx = createTestContext();
    const now = ctx.clock.now();
    const bossId = Number(
      ctx.db
        .prepare("INSERT INTO bosses (boss_def_id, location, max_hp, hp, spawned_at, expires_at, status) VALUES ('lake-legend', 'lake', 100, 100, ?, ?, 'active')")
        .run(now, now + 1000).lastInsertRowid,
    );
    const eventId = Number(
      ctx.db.prepare("INSERT INTO server_events (type, starts_at, ends_at, status) VALUES ('tournament', ?, ?, 'active')").run(now, now + 1000).lastInsertRowid,
    );

    seedFullUser(ctx, 'target', bossId, eventId);
    seedFullUser(ctx, 'other', bossId, eventId);

    for (const table of PER_USER_TABLES) {
      expect(countRows(ctx, table, 'target')).toBeGreaterThan(0);
      expect(countRows(ctx, table, 'other')).toBeGreaterThan(0);
    }

    resetUser(ctx, 'actor-1', 'target');

    for (const table of PER_USER_TABLES) {
      expect(countRows(ctx, table, 'target')).toBe(0);
      expect(countRows(ctx, table, 'other')).toBeGreaterThan(0);
    }

    // global tables untouched
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM bosses').get() as { n: number }).n).toBe(1);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM server_events').get() as { n: number }).n).toBe(1);

    const audit = listAudit(ctx, 5);
    expect(audit[0]?.action).toBe('admin:reset-user');
    expect(audit[0]?.actor_id).toBe('actor-1');
    expect(JSON.parse(audit[0]?.details ?? '{}')).toEqual({ targetId: 'target' });
  });

  it('is a no-op (no throw) for a user with no rows', () => {
    const ctx = createTestContext();
    expect(() => resetUser(ctx, 'actor-1', 'ghost')).not.toThrow();
  });
});
