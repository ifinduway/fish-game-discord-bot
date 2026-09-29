// Integration harness: a GameContext wired exactly like src/index.ts (all real subscribers via loadSubscribers, all
// scheduler jobs via loadJobs), a fake clock and seeded rng. The game is driven only through services.
import type { Rng } from '../../src/core/rng.js';
import { loadSubscribers } from '../../src/core/loader.js';
import type { LocationId } from '../../src/data/types.js';
import { DIRECTIONS } from '../../src/game/fishing-session.js';
import { loadJobs, runDueJobs, type Job } from '../../src/scheduler/index.js';
import {
  biteDelay,
  clearSessions,
  markBiteShown,
  pressHook,
  pressReel,
  setFishingTimers,
  startCast,
  startReelRound,
  type CastError,
  type FishingStep,
} from '../../src/services/fishing.js';
import { registerPassXpHandler } from '../../src/services/rewards.js';
import { createTestContext, type TestContext } from '../helpers.js';

export interface Game {
  ctx: TestContext;
  jobs: Job[];
  /** Runs every due scheduler job at the current fake time (like one scheduler tick). */
  tick(): Promise<string[]>;
  subscribers: string[];
}

/** Fresh DB + fresh bus with every real subscriber and job loaded (the way src/index.ts boots). */
export async function createGame(opts: { seed?: number; now?: number } = {}): Promise<Game> {
  const ctx = createTestContext(opts);
  const subscribers = await loadSubscribers(ctx.bus);
  const jobs = await loadJobs();
  const lastRun = new Map<string, number>();
  return { ctx, jobs, subscribers, tick: () => runDueJobs(ctx, jobs, lastRun) };
}

/** Clears module-level state shared between tests (pass-XP hook, fishing sessions, timers). */
export function resetGlobals(): void {
  registerPassXpHandler(null);
  clearSessions();
  setFishingTimers(null);
}

export interface CastPlay {
  /** ms between «Клюёт!» becoming visible and the hook press */
  reactionMs: number;
  /** probability of pressing the right reel direction */
  reelAccuracy: number;
  rng: Rng;
  location?: LocationId | null;
}

export type CastOutcome = { ok: false; error: CastError } | { ok: true; step: Exclude<FishingStep, { kind: 'invalid' } | { kind: 'reel' }>; cost: number };

/** One full cast through the fishing service: cast → bite after 1.5–5 s → hook press → reel rounds (if any). */
export function playCast(ctx: TestContext, userId: string, p: CastPlay): CastOutcome {
  const r = startCast(ctx, userId, { location: p.location });
  if (!r.ok) return { ok: false, error: r.error };
  const sid = r.session.id;
  ctx.clock.advance(biteDelay(ctx));
  markBiteShown(sid, ctx.clock.now());
  ctx.clock.advance(p.reactionMs);
  let step = pressHook(ctx, sid, ctx.clock.now());
  while (step.kind === 'reel') {
    startReelRound(sid, ctx.clock.now());
    ctx.clock.advance(p.rng.int(400, 1800));
    const target = step.target;
    const dir = p.rng.chance(p.reelAccuracy) ? target : DIRECTIONS.find((d) => d !== target)!;
    step = pressReel(ctx, sid, step.round - 1, dir, ctx.clock.now());
  }
  if (step.kind === 'invalid') throw new Error('fishing session became invalid mid-cast');
  return { ok: true, step, cost: r.session.castCost };
}
