// fish_caught during an active tournament → best weight per user (see services/server-events.ts).
import type { EventBus } from '../core/events.js';
import { recordTournamentCatch } from '../services/server-events.js';

export default function register(bus: EventBus): void {
  bus.on('fish_caught', (e, ctx) => {
    recordTournamentCatch(ctx, e);
  });
}
