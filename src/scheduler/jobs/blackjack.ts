// Auto-stands expired blackjack hands (60 s inactivity). DB-driven, so it also recovers hands left active by a restart
// (the scheduler runs every job on its first tick). No Discord client here: hands are settled in the DB only; the stale
// table message shows the final result on the next button press (see discord/commands/blackjack.ts).
import type { Job } from '../index.js';
import { expireStale } from '../../services/blackjack.js';

const job: Job = {
  name: 'blackjack-expire',
  everyMinutes: 1,
  run(ctx) {
    const settled = expireStale(ctx);
    if (settled.length > 0) console.log(`[blackjack] auto-stood ${settled.length} expired hand(s)`);
  },
};

export default job;
