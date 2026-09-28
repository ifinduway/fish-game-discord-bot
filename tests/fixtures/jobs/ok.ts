import type { Job } from '../../../src/scheduler/index.js';

export const runs: number[] = [];
const job: Job = { name: 'ok', everyMinutes: 5, run: (ctx) => void runs.push(ctx.clock.now()) };
export default job;
