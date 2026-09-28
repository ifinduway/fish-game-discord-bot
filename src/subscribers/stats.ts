// The ONLY writer of per-player `stats` counters for game events (other WPs emit events instead), plus the
// server_stats casts/catches/total_weight counters.
//
// Load order: the loader imports subscribers alphabetically (achievements < challenges < pass < stats), so an
// achievements subscriber would run BEFORE the counters are updated. Therefore this subscriber triggers the
// achievement check itself right after writing (services/achievements.checkAchievements on the touched metrics);
// subscribers/achievements.ts only does full re-checks on non-stat events.
import type { GameContext } from '../core/context.js';
import type { EventBus, GameEvent, GameEventType } from '../core/events.js';
import { rarityAtLeast } from '../data/types.js';
import { markRun } from '../db/repos/periodic.js';
import { incServerStat } from '../db/repos/server-stats.js';
import * as stats from '../db/repos/stats.js';
import { checkAchievements } from '../services/achievements.js';
import { ensureActiveSeason } from '../services/season.js';

export interface StatUpdate {
  metric: string;
  op: 'inc' | 'max';
  value: number;
}

/** Per-player stat updates for an event (plan §5 vocabulary). */
export function eventToStatUpdates(e: GameEvent): StatUpdate[] {
  const out: StatUpdate[] = [];
  const inc = (metric: string, value = 1): void => {
    if (value !== 0) out.push({ metric, op: 'inc', value });
  };
  const max = (metric: string, value: number): void => {
    out.push({ metric, op: 'max', value });
  };
  switch (e.type) {
    case 'cast':
      inc('casts');
      break;
    case 'fish_caught':
      inc('catches');
      inc('total_weight', e.weight);
      max('heaviest_weight', e.weight);
      inc(`catch_${e.rarity}`);
      if (rarityAtLeast(e.rarity, 'rare')) inc('rare_plus');
      if (rarityAtLeast(e.rarity, 'epic')) inc('epic_plus');
      if (e.perfect) inc('perfects');
      if (e.firstOfSpecies) inc('new_species');
      break;
    case 'fish_escaped':
      inc('escapes');
      break;
    case 'junk_caught':
      inc('junk');
      break;
    case 'treasure_found':
      inc('coins_earned', e.coins);
      inc('pearls_earned', e.pearls);
      break;
    case 'fish_sold':
      inc('coins_earned', e.coins);
      break;
    case 'coins_spent':
      inc('coins_spent', e.amount);
      break;
    case 'chest_opened':
      inc('chests_opened');
      break;
    case 'boss_damage':
      inc('boss_damage', e.damage);
      break;
    case 'blackjack_finished':
      inc('bj_hands');
      if (e.result === 'win' || e.result === 'blackjack') inc('bj_wins');
      if (e.result === 'blackjack') inc('bj_blackjacks');
      if (e.result === 'lose' || e.result === 'bust') inc('bj_losses');
      if (e.result === 'push') inc('bj_pushes');
      inc('bj_net', e.net);
      if (e.net > 0) max('bj_biggest_win', e.net);
      break;
    case 'daily_claimed':
      inc('daily_claims');
      break;
    default:
      break;
  }
  return out;
}

/** Server-wide counters for an event. */
export function eventToServerStats(e: GameEvent): { metric: string; value: number }[] {
  if (e.type === 'cast') return [{ metric: 'casts', value: 1 }];
  if (e.type === 'fish_caught') return [{ metric: 'catches', value: 1 }, { metric: 'total_weight', value: e.weight }];
  return [];
}

export const STAT_EVENT_TYPES = [
  'cast',
  'fish_caught',
  'fish_escaped',
  'junk_caught',
  'treasure_found',
  'fish_sold',
  'coins_spent',
  'chest_opened',
  'boss_damage',
  'blackjack_finished',
  'daily_claimed',
] as const satisfies readonly GameEventType[];

type StatEvent = Extract<GameEvent, { type: (typeof STAT_EVENT_TYPES)[number] }>;

function handle(e: StatEvent, ctx: GameContext) {
  const userId = e.userId;
  const updates = eventToStatUpdates(e);
  const server = eventToServerStats(e);
  const touched = new Set<string>();
  ctx.db.transaction(() => {
    ensureActiveSeason(ctx); // so the 's:<id>' scope always exists
    const scopes = stats.defaultScopes(ctx);
    for (const u of updates) {
      if (u.op === 'inc') stats.inc(ctx, userId, u.metric, u.value, scopes);
      else stats.max(ctx, userId, u.metric, u.value, scopes);
      touched.add(u.metric);
    }
    // bosses_joined: once per (user, boss); periodic_runs is used as an idempotency ledger
    if (e.type === 'boss_damage' && markRun(ctx, `boss_join:${userId}`, String(e.bossId))) {
      stats.inc(ctx, userId, 'bosses_joined', 1, scopes);
      touched.add('bosses_joined');
    }
    for (const s of server) incServerStat(ctx, s.metric, s.value);
  })();
  return touched.size > 0 ? checkAchievements(ctx, userId, [...touched]) : [];
}

export default function register(bus: EventBus): void {
  for (const type of STAT_EVENT_TYPES) bus.on(type, handle);
}
