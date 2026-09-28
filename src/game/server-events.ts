// Pure server-event definitions (bite hour / tournament): names, prizes, auto-schedule helpers.
import { BALANCE } from '../config/balance.js';
import type { Reward } from '../data/types.js';

export type ServerEventType = 'bite_hour' | 'tournament';
export const SERVER_EVENT_TYPES: ServerEventType[] = ['bite_hour', 'tournament'];

export const SERVER_EVENT_INFO: Record<ServerEventType, { name: string; emoji: string; description: string }> = {
  bite_hour: {
    name: 'Час клёва',
    emoji: '🎣',
    description: `Шанс редкой рыбы ×${BALANCE.events.biteHourRarityMultiplier} для всех!`,
  },
  tournament: {
    name: 'Турнир',
    emoji: '🏆',
    description: 'Кто поймает самую тяжёлую рыбу? Призы получат топ-3.',
  },
};

export function isServerEventType(x: string): x is ServerEventType {
  return (SERVER_EVENT_TYPES as string[]).includes(x);
}

export function eventDurationMs(type: ServerEventType): number {
  return (type === 'bite_hour' ? BALANCE.events.biteHourMinutes : BALANCE.events.tournamentMinutes) * 60_000;
}

/** Prize for a 1-based tournament place, or null outside the prize places. */
export function tournamentPrize(place: number): Reward | null {
  const p = BALANCE.events.tournamentPrizes[place - 1];
  return p ? { pearls: p.pearls, coins: p.coins } : null;
}

export interface TournamentEntry {
  userId: string;
  bestWeight: number;
  speciesId: string;
}

/** Sort: best weight desc, userId asc. */
export function rankTournament(entries: TournamentEntry[]): TournamentEntry[] {
  return [...entries].sort((a, b) => b.bestWeight - a.bestWeight || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/** Deterministic hash of a string → [0, 1). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Local hour at which the (possible) automatic event of `dayKey` starts: deterministic in [hourMin, hourMax]. */
export function autoEventHour(dayKey: string): number {
  const { hourMin, hourMax } = BALANCE.events.auto;
  return hourMin + Math.floor(hash01(`auto-event:${dayKey}`) * (hourMax - hourMin + 1));
}
