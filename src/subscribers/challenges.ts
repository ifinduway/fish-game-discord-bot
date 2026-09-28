// Challenge progress from game events (metric mapping lives in game/challenges.ts).
// Challenges are generated lazily before applying, so progress counts even if the player never opened /challenges.
import type { GameContext } from '../core/context.js';
import type { EventBus, GameEvent, GameEventType, Notice } from '../core/events.js';
import { eventToChallengeProgress } from '../game/challenges.js';
import { applyProgress, ensureChallenges } from '../services/challenges.js';

export const CHALLENGE_EVENT_TYPES = [
  'cast',
  'fish_caught',
  'fish_sold',
  'chest_opened',
  'boss_damage',
  'blackjack_finished',
  'coins_spent',
  'gear_upgraded',
] as const satisfies readonly GameEventType[];

type ChallengeEvent = Extract<GameEvent, { type: (typeof CHALLENGE_EVENT_TYPES)[number] }>;

function handle(e: ChallengeEvent, ctx: GameContext): Notice[] {
  const updates = eventToChallengeProgress(e);
  if (updates.length === 0) return [];
  ensureChallenges(ctx, e.userId);
  const notices: Notice[] = [];
  for (const u of updates) notices.push(...applyProgress(ctx, e.userId, u.metric, u.amount, u.meta));
  return notices;
}

export default function register(bus: EventBus): void {
  for (const type of CHALLENGE_EVENT_TYPES) bus.on(type, handle);
}
