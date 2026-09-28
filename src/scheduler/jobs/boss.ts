// Boss job: expire bosses past expires_at (consolation rewards), then spawn on schedule (Tue & Fri 18:00 server tz).
import type { Job } from '../index.js';
import { expireDueBosses, runScheduledBossSpawn } from '../../services/boss.js';

const job: Job = {
  name: 'boss',
  everyMinutes: 1,
  run(ctx) {
    expireDueBosses(ctx);
    runScheduledBossSpawn(ctx);
  },
};
export default job;
