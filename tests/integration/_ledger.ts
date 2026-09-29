// Pass-through spy for services/rewards.grantReward: records every reward bundle (with the coins that duplicate gear
// converts to) so tests can reconcile currency balances against their sources. Use from a test file with:
//   vi.mock('../../src/services/rewards.js', async (orig) => (await import('./_ledger.js')).wrapRewards(await orig()));
import { BALANCE } from '../../src/config/balance.js';
import { GEAR_BY_ID } from '../../src/data/gear.js';
import type { Reward } from '../../src/data/types.js';
import { hasGear } from '../../src/db/repos/inventory.js';
import type * as Rewards from '../../src/services/rewards.js';

export interface LedgerEntry {
  userId: string;
  source: string;
  pearls: number;
  /** reward coins + coins from duplicate gear */
  coins: number;
}

export const ledger: LedgerEntry[] = [];

export function wrapRewards(orig: typeof Rewards): typeof Rewards {
  return {
    ...orig,
    grantReward: (ctx, userId, reward: Reward, source) => {
      let dupCoins = 0;
      const seen = new Set<string>();
      for (const g of reward.gear ?? []) {
        const def = GEAR_BY_ID[g];
        if (def && (seen.has(g) || (hasGearSafe(ctx, userId, g)))) dupCoins += BALANCE.gearDuplicateCoins[def.tier];
        seen.add(g);
      }
      const res = orig.grantReward(ctx, userId, reward, source);
      ledger.push({
        userId,
        source,
        pearls: Math.max(0, Math.floor(reward.pearls ?? 0)),
        coins: Math.max(0, Math.floor(reward.coins ?? 0)) + dupCoins,
      });
      return res;
    },
  };
}

function hasGearSafe(ctx: Parameters<typeof hasGear>[0], userId: string, gearId: string): boolean {
  try {
    return hasGear(ctx, userId, gearId);
  } catch {
    return false;
  }
}

/** Sum of ledger coins/pearls for a user from entry index `from` on. */
export function ledgerSince(from: number, userId: string): { coins: number; pearls: number } {
  let coins = 0;
  let pearls = 0;
  for (const l of ledger.slice(from)) {
    if (l.userId !== userId) continue;
    coins += l.coins;
    pearls += l.pearls;
  }
  return { coins, pearls };
}
