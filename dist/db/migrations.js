/** Migrations keyed by PRAGMA user_version: MIGRATIONS[i] brings the schema to version i+1. Append only. */
export const MIGRATIONS = [
    // #1 — authoritative schema (plan §5)
    `
CREATE TABLE guild_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE players (
  user_id TEXT PRIMARY KEY, username TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0,
  energy REAL NOT NULL, energy_updated_at INTEGER NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0 CHECK (coins >= 0), pearls INTEGER NOT NULL DEFAULT 0 CHECK (pearls >= 0),
  cage_capacity INTEGER NOT NULL DEFAULT 50,
  daily_streak INTEGER NOT NULL DEFAULT 0, last_daily_key TEXT,
  drinks_day_key TEXT, drinks_used INTEGER NOT NULL DEFAULT 0,
  bj_day_key TEXT, bj_hands INTEGER NOT NULL DEFAULT 0,
  pity_silver INTEGER NOT NULL DEFAULT 0, pity_gold INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT 'pond',
  active_title TEXT, active_frame TEXT, active_background TEXT
);
CREATE TABLE caught_fish (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES players(user_id), species_id TEXT NOT NULL,
  weight REAL NOT NULL, quality INTEGER NOT NULL, value INTEGER NOT NULL, location TEXT NOT NULL, caught_at INTEGER NOT NULL,
  staked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_fish_user ON caught_fish(user_id);
CREATE TABLE gear_items (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES players(user_id), gear_id TEXT NOT NULL,
  upgrade INTEGER NOT NULL DEFAULT 0, acquired_at INTEGER NOT NULL);
CREATE TABLE equipped (user_id TEXT NOT NULL, slot TEXT NOT NULL, gear_item_id INTEGER NOT NULL REFERENCES gear_items(id), PRIMARY KEY (user_id, slot));
CREATE TABLE consumables (user_id TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL CHECK (qty >= 0), PRIMARY KEY (user_id, item_id));
CREATE TABLE active_bait (user_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, casts_left INTEGER NOT NULL);
CREATE TABLE cosmetics (user_id TEXT NOT NULL, cosmetic_id TEXT NOT NULL, acquired_at INTEGER NOT NULL, source TEXT, PRIMARY KEY (user_id, cosmetic_id));
CREATE TABLE collection (user_id TEXT NOT NULL, species_id TEXT NOT NULL, first_caught_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  best_weight REAL NOT NULL DEFAULT 0, best_quality INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, species_id));
-- generic counters: scope = 'all' | 'd:<dayKey>' | 'w:<weekKey>' | 's:<seasonId>'
CREATE TABLE stats (user_id TEXT NOT NULL, scope TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, PRIMARY KEY (user_id, scope, metric));
CREATE INDEX idx_stats_board ON stats(scope, metric, value DESC);
CREATE TABLE server_stats (scope TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, PRIMARY KEY (scope, metric));
CREATE TABLE species_records (species_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, weight REAL NOT NULL, caught_at INTEGER NOT NULL);
CREATE TABLE challenges (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, scope TEXT NOT NULL, period_key TEXT NOT NULL, template_id TEXT NOT NULL,
  param TEXT, target INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, completed_at INTEGER, UNIQUE (user_id, scope, period_key, template_id));
CREATE TABLE challenge_bonuses (user_id TEXT NOT NULL, scope TEXT NOT NULL, period_key TEXT NOT NULL, PRIMARY KEY (user_id, scope, period_key));
CREATE TABLE achievements (user_id TEXT NOT NULL, achievement_id TEXT NOT NULL, tier INTEGER NOT NULL, achieved_at INTEGER NOT NULL, PRIMARY KEY (user_id, achievement_id, tier));
CREATE TABLE seasons (id INTEGER PRIMARY KEY, theme_id TEXT NOT NULL, name TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','ended')));
CREATE TABLE season_pass (user_id TEXT NOT NULL, season_id INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, season_id));
CREATE TABLE bosses (id INTEGER PRIMARY KEY, boss_def_id TEXT NOT NULL, location TEXT NOT NULL, max_hp INTEGER NOT NULL, hp INTEGER NOT NULL,
  spawned_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','defeated','expired')), rewarded INTEGER NOT NULL DEFAULT 0);
CREATE TABLE boss_contributions (boss_id INTEGER NOT NULL REFERENCES bosses(id), user_id TEXT NOT NULL, damage INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (boss_id, user_id));
CREATE TABLE server_goals (week_key TEXT PRIMARY KEY, metric TEXT NOT NULL, target REAL NOT NULL, progress REAL NOT NULL DEFAULT 0, completed_at INTEGER, rewarded INTEGER NOT NULL DEFAULT 0);
CREATE TABLE server_events (id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('bite_hour','tournament')), starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','finished')), rewarded INTEGER NOT NULL DEFAULT 0);
CREATE TABLE tournament_entries (event_id INTEGER NOT NULL REFERENCES server_events(id), user_id TEXT NOT NULL, best_weight REAL NOT NULL, species_id TEXT NOT NULL, PRIMARY KEY (event_id, user_id));
CREATE TABLE blackjack_hands (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, stake_type TEXT NOT NULL CHECK (stake_type IN ('coins','fish')),
  stake_value INTEGER NOT NULL, staked_fish TEXT NOT NULL DEFAULT '[]', deck TEXT NOT NULL, player_cards TEXT NOT NULL, dealer_cards TEXT NOT NULL,
  doubled INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK (status IN ('active','finished')), result TEXT, payout INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, channel_id TEXT, message_id TEXT);
CREATE UNIQUE INDEX idx_bj_one_active ON blackjack_hands(user_id) WHERE status = 'active';
CREATE TABLE periodic_runs (job TEXT NOT NULL, period_key TEXT NOT NULL, ran_at INTEGER NOT NULL, PRIMARY KEY (job, period_key));
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, details TEXT);
`,
];
export function schemaVersion(db) {
    return db.pragma('user_version', { simple: true });
}
/** Applies all pending migrations, each in its own transaction. Returns the final schema version. */
export function migrate(db) {
    let version = schemaVersion(db);
    for (let i = version; i < MIGRATIONS.length; i++) {
        const sql = MIGRATIONS[i];
        db.transaction(() => {
            db.exec(sql);
            db.pragma(`user_version = ${i + 1}`);
        })();
        version = i + 1;
    }
    return version;
}
//# sourceMappingURL=migrations.js.map