import { loadModules } from '../core/loader.js';
export const JOBS_DIR = new URL('./jobs/', import.meta.url);
function isJob(x) {
    const j = x;
    return !!j && typeof j.name === 'string' && typeof j.everyMinutes === 'number' && typeof j.run === 'function';
}
export async function loadJobs(dir = JOBS_DIR) {
    const mods = await loadModules(dir);
    const jobs = [];
    const names = new Set();
    for (const { file, module } of mods) {
        if (!isJob(module.default)) {
            console.warn(`[scheduler] ${file} has no valid default Job export — skipped`);
            continue;
        }
        if (names.has(module.default.name))
            throw new Error(`Duplicate job name: ${module.default.name}`);
        names.add(module.default.name);
        jobs.push(module.default);
    }
    return jobs;
}
/** Runs due jobs sequentially; a failing job is logged and does not affect the others. Mutates `lastRun`. */
export async function runDueJobs(ctx, jobs, lastRun, now = ctx.clock.now()) {
    const ran = [];
    for (const job of jobs) {
        const last = lastRun.get(job.name);
        if (last !== undefined && now - last < job.everyMinutes * 60_000 - 1000)
            continue;
        lastRun.set(job.name, now);
        try {
            await job.run(ctx);
            ran.push(job.name);
        }
        catch (err) {
            console.error(`[scheduler] job '${job.name}' failed:`, err);
        }
    }
    return ran;
}
export function startScheduler(ctx, jobs, opts = {}) {
    const lastRun = new Map();
    let running = false;
    const tick = async () => {
        if (running)
            return;
        running = true;
        try {
            await runDueJobs(ctx, jobs, lastRun);
        }
        finally {
            running = false;
        }
    };
    const timer = setInterval(() => void tick(), opts.tickMs ?? 60_000);
    timer.unref?.();
    void tick();
    return { stop: () => clearInterval(timer), tick };
}
//# sourceMappingURL=index.js.map