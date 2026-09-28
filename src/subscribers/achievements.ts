// Achievement re-checks on events that do not go through the stats subscriber.
// The regular check after every counter update is triggered by subscribers/stats.ts itself (the loader runs
// subscribers alphabetically, so a check registered here for stat events would read stale counters).
// A full re-check here also covers achievements on stats written by other services (e.g. collection).
import type { EventBus } from '../core/events.js';
import { checkAchievements } from '../services/achievements.js';

export default function register(bus: EventBus): void {
  bus.on('level_up', (e, ctx) => checkAchievements(ctx, e.userId));
  bus.on('challenge_completed', (e, ctx) => checkAchievements(ctx, e.userId));
  bus.on('pass_level_up', (e, ctx) => checkAchievements(ctx, e.userId));
}
