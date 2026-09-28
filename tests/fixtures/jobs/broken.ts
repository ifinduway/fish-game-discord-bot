import type { Job } from '../../../src/scheduler/index.js';

const job: Job = {
  name: 'broken',
  everyMinutes: 1,
  run: () => {
    throw new Error('job failure');
  },
};
export default job;
