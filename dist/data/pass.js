// STUB (WP0) — WP1 replaces the contents but must keep export names/types.
import { BALANCE } from '../config/balance.js';
export const PASS_REWARDS = Array.from({ length: BALANCE.pass.levels }, (_, i) => {
    const level = i + 1;
    return { level, reward: level % 5 === 0 ? { pearls: 10 } : { coins: 100 * level } };
});
//# sourceMappingURL=pass.js.map