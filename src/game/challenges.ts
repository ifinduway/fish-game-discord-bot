// Challenge logic (pure): template picking, target rolls, titles, param matching, event → metric mapping.
import type { Rng } from '../core/rng.js';
import type { GameEvent } from '../core/events.js';
import { LOCATION_BY_ID } from '../data/locations.js';
import { rarityAtLeast, type ChallengeMetric, type ChallengeTemplate, type LocationId } from '../data/types.js';

/** Extra data some metrics need to decide whether an event counts. */
export interface ProgressMeta {
  location?: string;
  /** kg */
  weight?: number;
}

export interface ProgressUpdate {
  metric: ChallengeMetric;
  amount: number;
  meta: ProgressMeta;
}

/** Up to `count` distinct random templates from `pool` (partial Fisher–Yates). */
export function pickTemplates(rng: Rng, pool: readonly ChallengeTemplate[], count: number): ChallengeTemplate[] {
  const arr = [...pool];
  const n = Math.max(0, Math.min(count, arr.length));
  for (let i = 0; i < n; i++) {
    const j = rng.int(i, arr.length - 1);
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, n);
}

export function rollTarget(rng: Rng, t: ChallengeTemplate): number {
  const [min, max] = t.target;
  return Math.max(1, rng.int(Math.min(min, max), Math.max(min, max)));
}

/** Human-readable param: location id → "🏞️ Река", anything else as is. */
export function formatParam(param: string | null | undefined): string {
  if (!param) return '';
  const loc = LOCATION_BY_ID[param as LocationId];
  return loc ? `${loc.emoji} ${loc.name}` : param;
}

/** Fills `{n}` and `{param}` placeholders of a template title. */
export function formatChallengeTitle(title: string, target: number, param?: string | null): string {
  return title.replaceAll('{n}', String(target)).replaceAll('{param}', formatParam(param));
}

/** Whether an event with `meta` counts for a challenge with `param`. */
export function matchesParam(metric: ChallengeMetric, param: string | null | undefined, meta: ProgressMeta): boolean {
  if (param === null || param === undefined || param === '') return true;
  if (metric === 'cast_at_location') return meta.location === param;
  if (metric === 'catch_heavier_than') {
    const kg = Number(param);
    return Number.isFinite(kg) && meta.weight !== undefined && meta.weight > kg;
  }
  return true;
}

/** Maps a game event to challenge metric progress. */
export function eventToChallengeProgress(e: GameEvent): ProgressUpdate[] {
  const out: ProgressUpdate[] = [];
  const add = (metric: ChallengeMetric, amount: number, meta: ProgressMeta = {}): void => {
    if (amount > 0) out.push({ metric, amount, meta });
  };
  switch (e.type) {
    case 'cast':
      add('cast_at_location', 1, { location: e.location });
      break;
    case 'fish_caught':
      add('catch', 1);
      if (rarityAtLeast(e.rarity, 'rare')) add('catch_rare_plus', 1);
      if (rarityAtLeast(e.rarity, 'epic')) add('catch_epic_plus', 1);
      if (e.perfect) add('perfect', 1);
      add('catch_heavier_than', 1, { weight: e.weight });
      if (e.firstOfSpecies) add('new_species', 1);
      // fractional kg accumulate (SQLite keeps REAL values in the INTEGER-affinity column); UI floors
      add('total_weight', e.weight);
      if (e.seasonal) add('catch_seasonal', 1);
      break;
    case 'fish_sold':
      add('sell_coins', e.coins);
      break;
    case 'chest_opened':
      add('open_chest', 1);
      break;
    case 'boss_damage':
      add('boss_damage', e.damage);
      break;
    case 'blackjack_finished':
      add('blackjack_hands', 1);
      break;
    case 'coins_spent':
      add('spend_coins', e.amount);
      break;
    case 'gear_upgraded':
      add('upgrade_gear', 1);
      break;
    default:
      break;
  }
  return out;
}
