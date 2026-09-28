// fish_caught at the active boss location → boss damage (see services/boss.ts).
import type { EventBus } from '../core/events.js';
import { handleBossCatch } from '../services/boss.js';

export default function register(bus: EventBus): void {
  bus.on('fish_caught', (e, ctx) => handleBossCatch(ctx, e));
}
