# Autopilot Implementation Plan — Discord-бот «Рыбалка»

Source spec: `.omc/specs/deep-interview-discord-fishing-bot.md` (READ IT FULLY — balance numbers, rules and Acceptance Criteria live there).
All user-facing text in the bot: **Russian**. Code, identifiers, comments: English.

## 1. Tech decisions (ADR summary)
| Decision | Choice | Why |
|---|---|---|
| Runtime | Node 22, TypeScript strict, ESM (`"type":"module"`, `module/moduleResolution: NodeNext`) | modern, matches env |
| Discord | discord.js v14 | spec |
| DB | better-sqlite3 (sync API, WAL) + hand-written typed repositories, SQL migrations keyed by `PRAGMA user_version` | single server, sync transactions are trivial & safe (`db.transaction`) — no ORM codegen step for parallel agents |
| Time zones | luxon | day/week keys in server TZ (default `Europe/Moscow`) |
| Scheduler | node-cron (evaluated every minute by a single tick job that checks due work idempotently) | resets survive restarts because they are idempotent by period key |
| Images | @napi-rs/canvas, fonts in `assets/fonts/` (Roboto/Inter TTF with Cyrillic, OFL) with system-font fallback | spec |
| Tests | vitest, in-memory SQLite (`:memory:`), seeded RNG, fake clock | spec |
| Dev run | `tsx` (`yarn dev`), prod `tsc` → `dist/` (`yarn build && yarn start`) | |

Deviation note: spec suggested Drizzle/Kysely; we use typed repositories over better-sqlite3 (still type-safe at the boundary, fewer moving parts).

## 2. Layering (strict)
```
discord/ (commands, component handlers, embeds)  →  services/ (transactions, orchestration, emits events)
                                                  →  game/ (PURE logic: no db, no discord, injected rng/clock)
                                                  →  data/ (static catalogs, typed)
services/ → db/repos/ ; render/ is called only from discord/ layer
subscribers/ (event listeners: challenges, pass, boss, goals, stats, achievements, tournaments)
scheduler/jobs/ (periodic idempotent jobs)
```
- `game/*` must be unit-testable without Discord/DB.
- Every money/inventory mutation happens inside `ctx.db.transaction(...)`.
- Services never import discord.js. Discord layer never writes SQL.

## 3. Directory & file ownership
```
package.json, tsconfig.json, vitest.config.ts, .env.example, .gitignore, README.md     [WP0]
assets/fonts/                                                                          [WP6]
src/index.ts                         bootstrap                                         [WP0]
src/deploy-commands.ts               register guild slash commands                     [WP0]
src/config/env.ts                    env parsing                                       [WP0]
src/config/balance.ts                ALL numeric balance constants (spec §1–§12)       [WP0]
src/core/rng.ts                      Rng interface + mulberry32 seeded + default       [WP0]
src/core/clock.ts                    Clock interface {now(): number} + system + fake   [WP0]
src/core/time.ts                     dayKey/weekKey/timeOfDay/nextReset in tz (luxon)  [WP0]
src/core/events.ts                   typed GameEvent union + EventBus                  [WP0]
src/core/context.ts                  GameContext type + createContext()                [WP0]
src/core/loader.ts                   auto-load modules from a directory                [WP0]
src/db/database.ts, src/db/migrations.ts (FULL schema below)                           [WP0]
src/db/repos/*.ts                    base repos: players, wallet, inventory, stats,
                                     config, audit                                     [WP0]
src/services/rewards.ts              grantReward(ctx, userId, Reward) (in-tx)          [WP0]
src/services/player.ts               getOrCreatePlayer, addXp/level-up                 [WP0]
src/game/levels.ts                   xp curve                                          [WP0]
src/data/types.ts                    ALL catalog types                                 [WP0]
src/render/types.ts                  ALL card input types + render function signatures [WP0]
src/render/index.ts                  re-exports (stubs in WP0, real impl WP6)          [WP0→WP6]
src/discord/types.ts                 Command / ComponentHandler interfaces             [WP0]
src/discord/registry.ts, router.ts   auto-load commands & component handlers          [WP0]
src/discord/ui.ts                    shared embed helpers, rarity colors, formatters   [WP0]

src/data/*.ts (fish, locations, gear, consumables, chests, cosmetics, challenges,
               achievements, seasons, pass, bosses, shop)                              [WP1]
src/game/{energy,gear-stats,catch,fishing-session,economy}.ts
src/services/{fishing,economy,shop,collection,stats}.ts
src/discord/commands/{fish,sell,shop,buy,equip,gear,upgrade,use,inventory,daily,
                      locations,collection}.ts                                         [WP2]
src/game/{challenges,achievements,pass}.ts
src/services/{challenges,achievements,season}.ts
src/subscribers/{challenges,achievements,pass,stats}.ts
src/scheduler/jobs/{season}.ts
src/discord/commands/{challenges,season,pass}.ts                                       [WP3]
src/game/{boss,leaderboard,server-events}.ts
src/services/{boss,leaderboard,server,server-events,announce}.ts
src/subscribers/{boss,server-goal,tournament}.ts
src/scheduler/jobs/{boss,weekly,server-events}.ts
src/discord/commands/{boss,top,server,profile,stats}.ts                               [WP4]
src/game/{chest,blackjack}.ts
src/services/{chest,blackjack}.ts
src/scheduler/jobs/blackjack.ts
src/discord/commands/{chest,blackjack}.ts                                              [WP5]
src/render/{fonts,common,profile,catch,chest,leaderboard,boss,blackjack,season}.ts     [WP6]
src/discord/commands/{admin,help}.ts                                                   [WP7]
tests/**                              each WP writes tests for its own modules
```
Rule: a WP edits ONLY its own files. If a WP needs something from WP0 files that is missing, it adds a minimal, backwards-compatible addition and reports it.

## 4. Core contracts (WP0 implements exactly these)

### 4.1 Context
```ts
export interface GameContext {
  db: Database.Database;           // better-sqlite3
  rng: Rng;                        // next(): [0,1); int(min,max) inclusive; float(min,max); pick<T>(arr); weighted<T>(items:{item:T,weight:number}[]): T; chance(p): boolean
  clock: Clock;                    // now(): number (ms epoch)
  bus: EventBus;
  config: { timezone: string; announceChannelId: string | null }; // live-read from guild_config via getter functions is fine
  announce?: (payload: AnnouncePayload) => Promise<void>; // injected by discord layer; services call ctx.announce?.(...)
}
```
### 4.2 Events (src/core/events.ts)
```ts
export type GameEvent =
 | { type: 'cast'; userId: string; location: LocationId; energySpent: number }
 | { type: 'fish_caught'; userId: string; speciesId: string; rarity: Rarity; weight: number; quality: number; perfect: boolean; location: LocationId; value: number; firstOfSpecies: boolean }
 | { type: 'fish_escaped'; userId: string; reason: 'late' | 'reel' | 'line' }
 | { type: 'junk_caught'; userId: string; itemName: string }
 | { type: 'treasure_found'; userId: string; coins: number; pearls: number }
 | { type: 'fish_sold'; userId: string; count: number; coins: number }
 | { type: 'coins_spent'; userId: string; amount: number; reason: string }
 | { type: 'chest_opened'; userId: string; chestId: ChestId; rewardRarity: Rarity }
 | { type: 'gear_upgraded'; userId: string; gearItemId: number; level: number }
 | { type: 'daily_claimed'; userId: string; streak: number }
 | { type: 'challenge_completed'; userId: string; scope: ChallengeScope; templateId: string }
 | { type: 'boss_damage'; userId: string; bossId: number; damage: number }
 | { type: 'boss_finished'; bossId: number; defeated: boolean }
 | { type: 'blackjack_finished'; userId: string; result: 'win'|'blackjack'|'lose'|'push'|'bust'; net: number; stakeType: 'coins'|'fish' }
 | { type: 'pass_level_up'; userId: string; seasonId: number; level: number }
 | { type: 'level_up'; userId: string; level: number };

export interface Notice { userId: string; text: string } // shown to the user after the command (e.g. "✅ Испытание выполнено: …")
export class EventBus {
  on<T extends GameEvent['type']>(type: T, handler: (e: Extract<GameEvent,{type:T}>, ctx: GameContext) => Notice[] | void): void;
  emit(e: GameEvent, ctx: GameContext): Notice[];  // synchronous; handlers run in order; handler errors are caught+logged, never break the caller; handlers may emit further events (depth guard 5)
}
```
Services emit events AFTER their own transaction commits and return collected `Notice[]` to the discord layer, which appends them to the reply (ephemeral follow-up or embed footer field).

### 4.3 Rewards (src/services/rewards.ts)
```ts
export interface Reward { coins?: number; pearls?: number; xp?: number; passXp?: number;
  items?: { itemId: string; qty: number }[];       // consumables & baits
  gear?: string[];                                  // gear catalog ids → new gear_items rows (duplicates → coins per balance.gearDuplicateCoins[tier])
  cosmetics?: string[];                             // titles/frames/backgrounds/badges (duplicates ignored)
}
export function grantReward(ctx, userId, reward, source: string): { notices: Notice[]; summary: string } // must be called inside a transaction or opens one; passXp → emits nothing itself but calls a hook registered by WP3: `registerPassXpHandler(fn)`; xp → services/player.addXp (level-up event)
export function formatReward(reward): string   // Russian, e.g. "🪙 120 · 🐚 5 · 🎁 Энергетик ×1"
```
### 4.4 Discord (src/discord/types.ts)
```ts
export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void>;
  autocomplete?(i: AutocompleteInteraction, ctx: GameContext): Promise<void>;
}
export interface ComponentHandler {           // buttons + select menus + modals
  prefix: string;                             // customId = `${prefix}:${...args}`; prefix unique across app
  handle(i: MessageComponentInteraction | ModalSubmitInteraction, args: string[], ctx: GameContext): Promise<void>;
}
```
Each file in `src/discord/commands/` exports `default` of type `Command` and optionally `export const components: ComponentHandler[]`. `registry.ts` auto-loads all of them (works for both `.ts` under tsx and `.js` in dist). Duplicate prefix/name → throw on startup.
Owner check helper in ui.ts: `assertOwner(i, ownerId)` → replies ephemeral "Это не твоя удочка 🎣" and returns false.

Each file in `src/subscribers/` exports `default function register(bus: EventBus): void`.
Each file in `src/scheduler/jobs/` exports `default { name: string; everyMinutes: number; run(ctx): Promise<void> | void }` — all jobs must be idempotent (use period keys / status columns).

### 4.5 Data types (src/data/types.ts)
```ts
export type Rarity = 'common'|'uncommon'|'rare'|'epic'|'legendary'|'mythic';
export const RARITIES: Rarity[]; export const RARITY_INFO: Record<Rarity,{ name: string /* Обычная… */; color: number; emoji: string }>;
export type LocationId = 'pond'|'river'|'lake'|'sea'|'deep';
export type TimeOfDay = 'morning'|'day'|'evening'|'night';
export interface FishSpecies { id: string; name: string; emoji: string; rarity: Rarity; locations: LocationId[]; times?: TimeOfDay[]; minWeight: number; maxWeight: number; basePrice: number; seasonTheme?: SeasonThemeId; description: string }
export interface LocationDef { id: LocationId; name: string; emoji: string; unlockLevel: number; description: string; junkChance: number }
export type GearSlot = 'rod'|'reel'|'line'|'outfit';
export interface GearStats { rarityBonus?: number /* additive multiplier e.g. 0.1 */; biteWindowMs?: number; weightBonus?: number; reelTimeMs?: number; reelMistakes?: number; maxWeight?: number; maxEnergy?: number; castCostReduction?: number; energyRegenBonus?: number }
export interface GearDef { id: string; slot: GearSlot; tier: Rarity; name: string; emoji: string; stats: GearStats; shopPrice?: number /* undefined → not in shop */; unlockLevel: number }
export type ConsumableKind = 'energy'|'bait';
export interface ConsumableDef { id: string; kind: ConsumableKind; name: string; emoji: string; description: string; shopPrice?: number; energy?: number; bait?: { casts: number; rarityBonus?: number; speciesBoost?: string[]; timeOfDay?: TimeOfDay[] } }
export type CosmeticType = 'title'|'frame'|'background'|'badge';
export interface CosmeticDef { id: string; type: CosmeticType; name: string; rarity: Rarity; color?: string; gradient?: [string,string] }
export type ChestId = 'wood'|'silver'|'gold';
export type LootEntry = { weight: number; rarity: Rarity } & ({ kind:'coins'; min:number; max:number } | { kind:'item'; itemId:string; qty:number } | { kind:'gear'; tier: Rarity } | { kind:'cosmetic'; cosmeticType: CosmeticType; tier: Rarity });
export interface ChestDef { id: ChestId; name: string; emoji: string; price: number /* pearls */; loot: LootEntry[]; pity?: { opens: number; minRarity: Rarity } }
export type ChallengeScope = 'daily'|'weekly'|'seasonal';
export type ChallengeMetric = 'catch'|'catch_rare_plus'|'catch_epic_plus'|'perfect'|'sell_coins'|'cast_at_location'|'catch_heavier_than'|'open_chest'|'boss_damage'|'new_species'|'blackjack_hands'|'total_weight'|'catch_seasonal'|'spend_coins'|'upgrade_gear';
export interface ChallengeTemplate { id: string; scope: ChallengeScope; metric: ChallengeMetric; param?: string /* location id or kg */; target: [number, number] /* min,max roll */; title: string /* with {n} {param} placeholders */; reward: Reward; passXp: number }
export interface AchievementDef { id: string; name: string; stat: string /* stats metric key, scope 'all' */; tiers: { threshold: number; reward: Reward; title?: string }[] }
export type SeasonThemeId = 'winter'|'spring'|'summer'|'autumn';
export interface SeasonTheme { id: SeasonThemeId; name: string; emoji: string; colors: [string,string]; }
export interface PassLevelReward { level: number; reward: Reward }
export interface BossDef { id: string; name: string; emoji: string; location: LocationId; hpPerPlayer: number; description: string }
```
### 4.6 Render API (src/render/types.ts + index.ts) — all return `Promise<Buffer>` (PNG)
```ts
renderProfileCard(d: ProfileCardData)       // avatarUrl, username, level, xp, xpNext, energy, maxEnergy, coins, pearls, title?, frame?, background?, gear: {slot,name,tier,upgrade}[], stats: {label,value}[], collection: {caught,total}, seasonPass?: {level,max}
renderCatchCard(d: CatchCardData)           // username, species {name, rarity, description}, weight, quality, perfect, value, location, firstOfSpecies, record?: boolean
renderChestCard(d: ChestCardData)           // chest {name}, reward {label, rarity, kind}, pityLeft?
renderLeaderboardCard(d: LeaderboardCardData) // title, subtitle, rows: {rank, username, value, avatarUrl?}[], highlightUserId?
renderBossCard(d: BossCardData)             // name, hp, maxHp, expiresAt, location, top: {username, damage}[]
renderBlackjackCard(d: BlackjackCardData)   // player: {cards: Card[], total}, dealer: {cards, total}, result, stake label, payout
renderSeasonSummaryCard(d: SeasonSummaryData) // season name, colors, categories: {title, winners: {username, value}[]}[]
```
Card = `{ rank: 'A'|'2'…'10'|'J'|'Q'|'K'; suit: '♠'|'♥'|'♦'|'♣' }` (defined in render/types.ts, reused by game/blackjack.ts).
WP0 ships stub implementations (small solid-color PNG with a text line) so every WP compiles & runs; WP6 replaces bodies.

## 5. Database schema (src/db/migrations.ts, migration #1) — AUTHORITATIVE
```sql
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
CREATE TABLE challenge_bonuses (user_id TEXT NOT NULL, scope TEXT NOT NULL, period_key TEXT NOT NULL, PRIMARY KEY (user_id, scope, period_key)); -- "all dailies done" bonus granted once
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
CREATE TABLE periodic_runs (job TEXT NOT NULL, period_key TEXT NOT NULL, ran_at INTEGER NOT NULL, PRIMARY KEY (job, period_key)); -- idempotency for scheduler
CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, details TEXT);
```
Stats metric keys (shared vocabulary; write via `repos/stats.inc(ctx, userId, metric, delta, scopes)` / `.max(...)`):
`casts, catches, escapes, perfects, junk, total_weight, heaviest_weight, coins_earned, coins_spent, pearls_earned, chests_opened, rare_plus, epic_plus, catch_<rarity>, new_species, boss_damage, bosses_joined, bj_hands, bj_wins, bj_losses, bj_pushes, bj_blackjacks, bj_net, bj_biggest_win, pass_xp, daily_claims`.
Default scopes for a counter: `['all', 'd:<day>', 'w:<week>', 's:<activeSeasonId>']` via `stats.defaultScopes(ctx)`.
Server stats (`server_stats`, scope 'all' & 'w:<week>'): `catches, total_weight, bosses_defeated, casts`.

## 6. Work packages
### WP0 — Foundation (sequential, first) — executor opus
Everything tagged [WP0] above + `yarn install` of deps: discord.js, better-sqlite3, @napi-rs/canvas, luxon, node-cron, dotenv; dev: typescript, tsx, vitest, @types/node, @types/better-sqlite3, @types/luxon, @types/node-cron.
Scripts: `dev` (tsx watch src/index.ts), `build` (tsc -p .), `start` (node dist/index.js), `deploy` (tsx src/deploy-commands.ts), `test` (vitest run), `typecheck` (tsc --noEmit).
Bootstrap (`index.ts`): load env → open DB (`DB_PATH`, default `data/fishing.db`) → migrate → build ctx → load subscribers → create Client (intents: Guilds) → registry: load commands & components → on ready: register guild commands (PUT to GUILD_ID) → start scheduler (every 60 s run jobs whose interval elapsed) → interaction routing with error handler (ephemeral "Что-то пошло не так 🐟" + console.error) → `ctx.announce` implementation (fetch channel from guild_config `announce_channel_id`, send embed/files).
`GameContext.config.timezone` from guild_config `timezone`, fallback env `TZ_DEFAULT`, fallback `Europe/Moscow`.
Tests: rng determinism, time keys (day/week boundaries in Moscow tz), migrations apply on `:memory:`, events bus error isolation, grantReward basics, levels curve.
DoD: `yarn typecheck`, `yarn test`, `yarn build` pass; `src/render` stubs present; a sample `ping` command is NOT needed.

### Parallel after WP0 (each writes its own tests):
- **WP1 Data** (sonnet): ≥50 regular species (≈10/location, all 6 rarities, times of day), 4 seasonal species per theme (16), 5 locations, 4 slots × 6 tiers gear (24) with sensible stat progression, consumables (energy drink + ≥5 baits), cosmetics (≥8 titles, ≥6 frames, ≥6 backgrounds, season badges per theme), 3 chests with loot tables + pity (gold: legendary+ within 20), ≥15 daily + ≥10 weekly + ≥12 seasonal challenge templates (incl. «Сыграть 3 раздачи» daily reward coins only, no pearls), ≥8 achievements (multi-tier), 4 season themes, 30-level pass rewards, ≥3 bosses, shop listings. Export lookup maps (`FISH_BY_ID`, etc.). Test: ids unique, every location has every rarity except mythic optional, chest weights > 0, referenced ids exist.
- **WP2 Fishing & economy** (opus): energy (lazy regen, drinks up to 150%, 3/day), gear stat aggregation incl. upgrades (+10%/level of numeric stats; cost = balance), species roll (location, time, level, season, rarity bonus from rod+bait+bite_hour event (read active server_events via a tiny query in service — WP4 owns table semantics; read-only `type='bite_hour' AND status='active' AND now between`), junk 5–10%, treasure 1%), weight/quality/price, fishing session state machine (in-memory Map keyed by userId, timers via ctx-injectable scheduler for tests), hook window & perfect (first 40%), reel rounds for rare+ (2–3 rounds, 3 buttons, 3 s + reel bonus, mistakes vs line), line max weight → 50% snap, refund 50% on escape, cage full blocks, XP on catch, collection & species records, stats counters, emits events. Commands: `/fish [location]` (location option with choices/autocomplete; also persists chosen location), `/sell` (all | rarity | fish id via autocomplete), `/shop` (categories via select menu, daily rotating offer), `/buy`, `/equip`, `/gear`, `/upgrade`, `/use`, `/inventory` (садок paginated + consumables + gear), `/daily` (pearls 3 + 1/day streak, max 10; missed day resets), `/locations`, `/collection` (paginated by location, ❓ for unknown). Catch card PNG for rare+ and announce epic+.
- **WP3 Progression** (opus): challenge generation (3 daily / 4 weekly / 10–15 seasonal per player, lazy `ensureChallenges`), progress via subscribers mapping events→metrics, auto-grant reward exactly once (unique completed_at update guarded), all-3-daily bonus +5 pearls once, achievements (tiered, titles), season lifecycle (auto-create season 1 on first run; 4 weeks; rollover job: finalize → top-3 of season categories [pass xp, boss damage, total weight] get permanent title cosmetic `season-<n>-top` + badge; announce season summary card; new season with next theme), pass XP hook (`registerPassXpHandler`) + 30 levels with auto-granted rewards, pass XP from casts/catches/challenges/boss. Commands `/challenges`, `/season`, `/pass`.
- **WP4 Social** (opus): boss (spawn Tue & Fri 18:00 server tz or admin; lives 24 h; max_hp = hpPerPlayer × max(5, active players last 7 days); damage from `fish_caught` at boss location = f(weight, quality, perfect); defeat → tiered rewards by contribution share, top-1 title; expiry → consolation), weekly server goal (auto-created per week, e.g. total weight 5000 kg scaled; completion → reward all players with casts this week), leaderboards (8 categories: heaviest_week, coins_week, rare_week, collection, pass_level, boss_damage_season, level, casino_week), weekly reset job Monday 00:00 (announce winners, top-1 of weekly categories get pearls), server events (bite_hour ×2 rare for 1 h; tournament 1 h heaviest fish, top-3 prizes), announce service (catch announcements helpers for epic+ used by WP2 via `services/announce.ts` → WP4 owns but WP2 may call `announceCatch`). Commands `/boss`, `/top <category>`, `/server`, `/profile [user]`, `/stats [user]`.
- **WP5 Chests & Blackjack** (sonnet/opus): chest roll with weights, pity counters (gold legendary+ ≤ 20 opens; silver epic+ ≤ 15), gear rolls pick random gear of tier, cosmetics roll, duplicate handling, spin animation (≥3 message edits ~700 ms), `/chest open <type> [count 1..5]`, `/chest info` (shows odds % from config). Blackjack engine pure (6-deck shoe, ace soft/hard, dealer stands soft 17, 3:2, double on first two cards coins only, no split/insurance), service (limits: min 10, max 100+50×level, 20 hands/day with day key; fish stake via select menu of ≤25 most valuable unstaked fish, mark staked=1; payouts: win 2×, blackjack 2.5×, push return; fish lose → delete; win → delete fish + pay coins; push → unstake), 60 s timeout job + restart recovery (auto-stand expired active hands), owner-only buttons, `/blackjack coins <amount>`, `/blackjack fish`, end card PNG.
- **WP6 Rendering** (designer/sonnet): implement all 7 render functions per §4.6 with polished look: dark rounded cards, rarity color accents & glow, gradient backgrounds, progress bars (energy, xp, boss hp), fish silhouette drawn with paths tinted by rarity, playing cards drawn with suits, Cyrillic fonts shipped in `assets/fonts` (download Roboto or Inter TTF, OFL). Script `yarn render:samples` writes all cards to `samples/*.png` for visual QA. Tests: each renderer returns a valid PNG buffer (magic bytes) for sample data.
- **WP7 Admin & help** (sonnet, after WP2–5 finish because it calls their services): `/admin config channel|timezone`, `/admin boss spawn|end`, `/admin event start <bite_hour|tournament>`, `/admin season start|end`, `/admin give <user> <coins|pearls|item|gear|cosmetic> <id?> <qty>`, `/admin reset-user <user>` (confirm button), all audited; default member permission ManageGuild + runtime check. `/help` — paged overview of all commands & mechanics in Russian.

### Integration & QA (after all WPs)
1. `yarn typecheck && yarn build && yarn test` green.
2. Simulation test (`tests/simulation.test.ts`): 100k seeded species rolls → rarity distribution within ±10% of configured odds; 5 simulated players play 7 days via services (fishing, sell, daily, challenges, chest, blackjack) with fake clock → no negative balances, invariants hold.
3. Concurrency test: parallel sell + chest open + blackjack stake cannot overspend.
4. `yarn render:samples` → visually inspect PNGs.
5. Startup smoke without token: `node dist/index.js` fails gracefully with clear "DISCORD_TOKEN не задан" message; with dummy config the registry loads all commands (unit test on registry: every command has unique name, valid JSON via `data.toJSON()`, every customId prefix unique).

## 7. Acceptance Criteria mapping
Every AC in spec → owning WP: energy/cast/hook/reel/species/gear/sell/cage/pearls-sources/daily/collection/epic-announce → WP2(+WP4 announce); chests → WP5; challenges/season/pass/titles → WP3; boss/goal/top/profile/stats/server → WP4 (+WP6 cards); blackjack → WP5; admin → WP7; data volume → WP1; transactions/concurrency/build/tests → all + QA.

## 8. Amendments after Critic review (BINDING — override anything above)
1. **WP0 ships stub data files**: every `src/data/*.ts` (fish, locations, gear, consumables, chests, cosmetics, challenges, achievements, seasons, pass, bosses, shop) exists after WP0 with the final export names and typed minimal content (empty arrays / 1 sample entry, lookup maps built from arrays). WP1 replaces bodies but MUST keep export names/types. Export names: `FISH, FISH_BY_ID, LOCATIONS, LOCATION_BY_ID, GEAR, GEAR_BY_ID, CONSUMABLES, CONSUMABLE_BY_ID, CHESTS, CHEST_BY_ID, COSMETICS, COSMETIC_BY_ID, CHALLENGE_TEMPLATES, CHALLENGE_BY_ID, ACHIEVEMENTS, SEASON_THEMES, SEASON_THEME_BY_ID, PASS_REWARDS, BOSSES, BOSS_BY_ID, SHOP_LISTINGS, JUNK_ITEMS`.
2. **Announce helpers live in WP0**: `src/services/announce.ts` (WP0) exports `announceCatch(ctx, data)`, `announceText(ctx, title, text, color?, file?)`. WP4 may add more functions to it (append-only).
3. **First-catch pearls** (1/2/4/8/15/30 by rarity, `balance.firstCatchPearls`) are granted by WP2 fishing service.
4. `fish_caught` event gets `seasonal: boolean`.
5. **Cage expansion**: WP1 shop has listing `cage_upgrade` (kind `'cage'`, +25 capacity, price grows: `balance.cageUpgradeBaseCost × 2^(n)`, max capacity 200); WP2 `/buy` supports it. `ShopListing = { id: string; kind: 'gear'|'consumable'|'cage'; refId?: string; price?: number; unlockLevel: number }` in data/types.ts.
6. **Multi-open chests**: one combined spin sequence (max 3 edits total, ≥800 ms apart) + one summary PNG listing all rewards.
7. **Pass XP wiring**: `balance.passXp = { cast: 2, catchByRarity: {common:3,uncommon:5,rare:10,epic:20,legendary:40,mythic:80}, dailyChallenge: 20, weeklyChallenge: 60, seasonalChallenge: 150, bossParticipation: 30 }`. WP3 subscribers grant pass XP from `cast` / `fish_caught` / `challenge_completed` / `boss_damage`(first hit per boss) events. WP2/WP4 do NOT grant pass XP directly.
8. **Gear duplicates → coins only** (`balance.gearDuplicateCoins[tier]`). Deliberate simplification of spec §6 "монеты или осколки".
9. **Discord timing rules (all WPs)**: always `deferReply`/`deferUpdate` if work may exceed ~2 s; hook window measured from the moment the "Клюёт!" edit promise resolves, window = `balance.hookWindowMs (2000) + rod bonus + balance.latencyGraceMs (400)`; perfect = first 40% of the base window; customIds ≤ 100 chars; select menus ≤ 25 options; animations ≥ 800 ms between edits.
