import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/database.js';
import { MIGRATIONS, migrate, schemaVersion } from '../../src/db/migrations.js';

const TABLES = [
  'guild_config', 'players', 'caught_fish', 'gear_items', 'equipped', 'consumables', 'active_bait', 'cosmetics', 'collection',
  'stats', 'server_stats', 'species_records', 'challenges', 'challenge_bonuses', 'achievements', 'seasons', 'season_pass',
  'bosses', 'boss_contributions', 'server_goals', 'server_events', 'tournament_entries', 'blackjack_hands', 'periodic_runs', 'audit_log',
];

describe('migrations', () => {
  it('apply on :memory: and create every table', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it('are idempotent', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
  });

  it('enforce CHECK constraints and one active blackjack hand per user', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO players (user_id, created_at, energy, energy_updated_at) VALUES ('u', 0, 100, 0)").run();
    expect(() => db.prepare("UPDATE players SET coins = -1 WHERE user_id = 'u'").run()).toThrow();
    const ins = db.prepare(
      "INSERT INTO blackjack_hands (user_id, stake_type, stake_value, deck, player_cards, dealer_cards, status, created_at, expires_at) VALUES ('u','coins',10,'[]','[]','[]','active',0,0)",
    );
    ins.run();
    expect(() => ins.run()).toThrow();
  });
});
