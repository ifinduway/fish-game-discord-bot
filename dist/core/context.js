import { getConfig, CONFIG_KEYS } from '../db/repos/config.js';
import { DEFAULT_TIMEZONE } from '../config/env.js';
import { systemClock } from './clock.js';
import { EventBus } from './events.js';
import { defaultRng } from './rng.js';
export function createContext(opts) {
    const { db } = opts;
    const fallbackTz = opts.defaultTimezone ?? DEFAULT_TIMEZONE;
    const config = {
        get timezone() {
            return getConfig({ db }, CONFIG_KEYS.timezone) ?? fallbackTz;
        },
        get announceChannelId() {
            return getConfig({ db }, CONFIG_KEYS.announceChannelId);
        },
    };
    return {
        db,
        rng: opts.rng ?? defaultRng,
        clock: opts.clock ?? systemClock,
        bus: opts.bus ?? new EventBus(),
        config,
        announce: opts.announce,
    };
}
//# sourceMappingURL=context.js.map