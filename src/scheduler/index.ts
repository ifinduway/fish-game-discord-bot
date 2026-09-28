// Scheduler: every tick (60 s) runs each job whose `everyMinutes` interval has elapsed since its last run.
// First tick runs all jobs (restart recovery). Jobs must be idempotent (period keys / status columns, see repos/periodic.ts).
import type { GameContext } from '../core/context.js';
import { loadModules } from '../core/loader.js';

export interface Job {
  name: string;
  everyMinutes: number;
  run(ctx: GameContext): Promise<void> | void;
}

export const JOBS_DIR = new URL('./jobs/', import.meta.url);

function isJob(x: unknown): x is Job {
  const j = x as Job | undefined;
  return !!j && typeof j.name === 'string' && typeof j.everyMinutes === 'number' && typeof j.run === 'function';
}

export async function loadJobs(dir: string | URL = JOBS_DIR): Promise<Job[]> {
  const mods = await loadModules<{ default?: unknown }>(dir);
  const jobs: Job[] = [];
  const names = new Set<string>();
  for (const { file, module } of mods) {
    if (!isJob(module.default)) {
      console.warn(`[scheduler] ${file} has no valid default Job export — skipped`);
      continue;
    }
    if (names.has(module.default.name)) throw new Error(`Duplicate job name: ${module.default.name}`);
    names.add(module.default.name);
    jobs.push(module.default);
  }
  return jobs;
}

/** Runs due jobs sequentially; a failing job is logged and does not affect the others. Mutates `lastRun`. */
export async function runDueJobs(ctx: GameContext, jobs: Job[], lastRun: Map<string, number>, now: number = ctx.clock.now()): Promise<string[]> {
  const ran: string[] = [];
  for (const job of jobs) {
    const last = lastRun.get(job.name);
    if (last !== undefined && now - last < job.everyMinutes * 60_000 - 1000) continue;
    lastRun.set(job.name, now);
    try {
      await job.run(ctx);
      ran.push(job.name);
    } catch (err) {
      console.error(`[scheduler] job '${job.name}' failed:`, err);
    }
  }
  return ran;
}

export interface SchedulerHandle {
  stop(): void;
  /** runs one tick immediately (skips if a tick is still running) */
  tick(): Promise<void>;
}

export function startScheduler(ctx: GameContext, jobs: Job[], opts: { tickMs?: number } = {}): SchedulerHandle {
  const lastRun = new Map<string, number>();
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      await runDueJobs(ctx, jobs, lastRun);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.tickMs ?? 60_000);
  timer.unref?.();
  void tick();
  return { stop: () => clearInterval(timer), tick };
}
