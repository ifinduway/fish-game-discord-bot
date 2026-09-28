// Server events job: finish events past ends_at (tournament prizes once), then maybe start the daily automatic event.
import type { Job } from '../index.js';
import { finishDueServerEvents, runAutoServerEvent } from '../../services/server-events.js';

const job: Job = {
  name: 'server-events',
  everyMinutes: 1,
  run(ctx) {
    finishDueServerEvents(ctx);
    runAutoServerEvent(ctx);
  },
};
export default job;
