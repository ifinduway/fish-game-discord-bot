// Weekly reset (Monday 00:00 server tz): award & announce the PREVIOUS week's leaderboard winners once
// (periodic_runs 'weekly' + previous week key). Weekly counters are keyed by week, so nothing is deleted.
import type { Job } from '../index.js';
import { runWeeklyReset } from '../../services/leaderboard.js';

const job: Job = {
  name: 'weekly',
  everyMinutes: 1,
  run(ctx) {
    runWeeklyReset(ctx);
  },
};
export default job;
