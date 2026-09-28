// fish_caught → weekly server goal progress (see services/server.ts).
import type { EventBus } from '../core/events.js';
import { addServerGoalProgress } from '../services/server.js';

export default function register(bus: EventBus): void {
  bus.on('fish_caught', (e, ctx) => addServerGoalProgress(ctx, e));
}
