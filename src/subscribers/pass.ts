// Season-pass XP sources (amendment §8.7): casts, catches by rarity, first boss hit per boss.
// Challenge pass XP is granted by services/challenges directly. Also wires Reward.passXp → addPassXp.
import { BALANCE } from '../config/balance.js';
import type { EventBus } from '../core/events.js';
import { markRun } from '../db/repos/periodic.js';
import { registerPassXpHandler } from '../services/rewards.js';
import { addPassXp } from '../services/season.js';

export default function register(bus: EventBus): void {
  registerPassXpHandler((ctx, userId, amount) => addPassXp(ctx, userId, amount));

  bus.on('cast', (e, ctx) => addPassXp(ctx, e.userId, BALANCE.passXp.cast));
  bus.on('fish_caught', (e, ctx) => addPassXp(ctx, e.userId, BALANCE.passXp.catchByRarity[e.rarity] ?? 0));
  bus.on('boss_damage', (e, ctx) => {
    // once per (user, boss); periodic_runs is used as an idempotency ledger
    if (!markRun(ctx, `pass_boss:${e.userId}`, String(e.bossId))) return [];
    return addPassXp(ctx, e.userId, BALANCE.passXp.bossParticipation);
  });
}
