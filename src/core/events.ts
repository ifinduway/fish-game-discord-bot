import type { ChallengeScope, ChestId, LocationId, Rarity } from '../data/types.js';
import type { GameContext } from './context.js';

export type GameEvent =
  | { type: 'cast'; userId: string; location: LocationId; energySpent: number }
  | {
      type: 'fish_caught';
      userId: string;
      speciesId: string;
      rarity: Rarity;
      weight: number;
      quality: number;
      perfect: boolean;
      location: LocationId;
      value: number;
      firstOfSpecies: boolean;
      seasonal: boolean;
    }
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
  | {
      type: 'blackjack_finished';
      userId: string;
      result: 'win' | 'blackjack' | 'lose' | 'push' | 'bust';
      net: number;
      stakeType: 'coins' | 'fish';
    }
  | { type: 'pass_level_up'; userId: string; seasonId: number; level: number }
  | { type: 'level_up'; userId: string; level: number };

export type GameEventType = GameEvent['type'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;

/** Shown to the user after the command (e.g. "✅ Испытание выполнено: …"). */
export interface Notice {
  userId: string;
  text: string;
}

export type EventHandler<T extends GameEventType> = (e: EventOf<T>, ctx: GameContext) => Notice[] | void;

export const MAX_EVENT_DEPTH = 5;

/**
 * Synchronous typed event bus. Handlers run in registration order; a throwing handler is logged and skipped.
 * Handlers may emit further events (depth guard MAX_EVENT_DEPTH). `emit` returns all collected notices.
 */
export class EventBus {
  private handlers = new Map<GameEventType, EventHandler<GameEventType>[]>();
  private depth = 0;

  on<T extends GameEventType>(type: T, handler: EventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as unknown as EventHandler<GameEventType>);
    this.handlers.set(type, list);
  }

  emit(e: GameEvent, ctx: GameContext): Notice[] {
    if (this.depth >= MAX_EVENT_DEPTH) {
      console.error(`[events] depth limit ${MAX_EVENT_DEPTH} reached, dropping event '${e.type}'`);
      return [];
    }
    const list = this.handlers.get(e.type);
    if (!list || list.length === 0) return [];
    const notices: Notice[] = [];
    this.depth++;
    try {
      for (const h of [...list]) {
        try {
          const out = h(e as EventOf<GameEventType>, ctx);
          if (Array.isArray(out)) notices.push(...out);
        } catch (err) {
          console.error(`[events] handler for '${e.type}' failed:`, err);
        }
      }
    } finally {
      this.depth--;
    }
    return notices;
  }

  /** Emits several events in order and concatenates their notices. */
  emitAll(events: GameEvent[], ctx: GameContext): Notice[] {
    const out: Notice[] = [];
    for (const e of events) out.push(...this.emit(e, ctx));
    return out;
  }

  listenerCount(type: GameEventType): number {
    return this.handlers.get(type)?.length ?? 0;
  }

  /** Removes all handlers (tests). */
  clear(): void {
    this.handlers.clear();
  }
}
