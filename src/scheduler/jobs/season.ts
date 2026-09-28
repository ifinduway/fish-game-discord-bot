// Season lifecycle job: creates season 1 on first run, finalizes an expired season once (status-guarded) and
// starts the next one, then announces the summary card. Idempotent: finalizeSeason is a no-op for ended seasons.
import type { Job } from '../index.js';
import { announceSeasonSummary, rolloverIfDue } from '../../services/season.js';

const job: Job = {
  name: 'season',
  everyMinutes: 5,
  async run(ctx) {
    const summary = rolloverIfDue(ctx);
    if (summary) await announceSeasonSummary(ctx, summary);
  },
};

export default job;
