// Integration QA (plan "Integration & QA" step 3): money/inventory operations on ONE player with tight balances,
// interleaved in many seeded random orders, with all real subscribers loaded (challenge/achievement rewards fire
// mid-sequence). Discord interactions interleave only at `await` points while every service call is synchronous and
// transactional, so "concurrency" = arbitrary orderings of whole operations (sequential, and bursts via Promise.all
// with random yields). Every coin/pearl movement is reconciled against its source (op result + grantReward ledger).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { seededRng, type Rng } from '../../src/core/rng.js';
import { countCaughtFish, getConsumableQty, listCaughtFish } from '../../src/db/repos/inventory.js';
import { getPlayer } from '../../src/db/repos/players.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { handValue, maxBet, type BjAction, type Card } from '../../src/game/blackjack.js';
import { giveReward, takeCurrency } from '../../src/services/admin.js';
import { act, BlackjackError, expireHand, getActiveHand, getHand, listStakeableFish, startCoins, startFish } from '../../src/services/blackjack.js';
import { ChestError, openChests } from '../../src/services/chest.js';
import { sellFish, type SellFilter } from '../../src/services/economy.js';
import { ensurePlayerReady } from '../../src/services/player-state.js';
import { buy } from '../../src/services/shop.js';
import { createGame, playCast, resetGlobals, type Game } from './_harness.js';
import { ledger, ledgerSince } from './_ledger.js';

vi.mock('../../src/services/rewards.js', async (importOriginal) =>
  (await import('./_ledger.js')).wrapRewards(await importOriginal<typeof import('../../src/services/rewards.js')>()),
);

afterEach(() => resetGlobals());

const U = 'u1';

interface OpResult {
  name: string;
  /** coins/pearls moved by the op itself (reported by the service), excluding rewards granted via grantReward */
  coins: number;
  pearls: number;
  /** fish removed from the cage by the op (sold / lost in blackjack) and added (caught) */
  fishOut: number;
  fishIn: number;
  failed?: boolean;
}

const ok = (name: string, d: Partial<OpResult> = {}): OpResult => ({ name, coins: 0, pearls: 0, fishOut: 0, fishIn: 0, ...d });

/** Counts fish removed by a settled blackjack hand (lose/bust/win delete the staked fish; push returns them). */
function settledFishOut(hand: { stakeType: string; stakedFish: number[]; state: { result: string | null } }): number {
  if (hand.stakeType !== 'fish' || !hand.state.result || hand.state.result === 'push') return 0;
  return hand.stakedFish.length;
}

function bjOutcomeDelta(name: string, o: ReturnType<typeof startCoins>, stakeCoins: number, stale: OpResult | null): OpResult {
  const payout = o.finished ? o.hand.payout : 0;
  const fishOut = o.finished ? settledFishOut(o.hand) : 0;
  return ok(name, { coins: payout - stakeCoins + (stale?.coins ?? 0), fishOut: fishOut + (stale?.fishOut ?? 0) });
}

function makeOps(game: Game, rng: Rng): (() => OpResult)[] {
  const { ctx } = game;
  const level = () => getPlayer(ctx, U)!.level;
  const sell = (): OpResult => {
    const fish = listCaughtFish(ctx, U, { includeStaked: true });
    const pick = rng.pick(['all', 'fish', 'staked', 'rarity'] as const);
    let filter: SellFilter = { kind: 'all' };
    if (pick === 'fish' && fish.length) filter = { kind: 'fish', fishId: rng.pick(fish).id };
    if (pick === 'staked') {
      const staked = fish.find((f) => f.staked === 1);
      if (staked) filter = { kind: 'fish', fishId: staked.id };
    }
    if (pick === 'rarity') filter = { kind: 'rarity', rarity: 'common' };
    const r = sellFish(ctx, U, filter);
    return ok(`sell:${filter.kind}`, { coins: r.coins, fishOut: r.count });
  };
  const chest = (): OpResult => {
    const id = rng.pick(['wood', 'wood', 'silver'] as const);
    const count = rng.int(1, 3);
    try {
      const r = openChests(ctx, U, id, count);
      return ok(`chest:${id}×${count}`, { pearls: -r.pearlsSpent });
    } catch (err) {
      if (err instanceof ChestError) return ok(`chest:${id}×${count}`, { failed: true });
      throw err;
    }
  };
  /** start() auto-stands an expired active hand first — account for that settlement too */
  const staleSettlement = (staleId: number | undefined): OpResult | null => {
    if (staleId === undefined) return null;
    const h = getHand(ctx, staleId)!;
    return h.status === 'finished' ? ok('stale', { coins: h.payout, fishOut: settledFishOut(h) }) : null;
  };
  const bjCoins = (): OpResult => {
    const stake = rng.int(BALANCE.blackjack.minBet, maxBet(level()));
    const stale = getActiveHand(ctx, U);
    try {
      const o = startCoins(ctx, U, stake);
      return bjOutcomeDelta(`bj:coins ${stake}`, o, stake, staleSettlement(stale?.id));
    } catch (err) {
      if (err instanceof BlackjackError) {
        const st = staleSettlement(stale?.id);
        return st ? { ...st, name: 'bj:coins (stale settled, stake refused)' } : ok('bj:coins', { failed: true });
      }
      throw err;
    }
  };
  const bjFish = (): OpResult => {
    const fish = listStakeableFish(ctx, U);
    if (fish.length === 0) return ok('bj:fish', { failed: true });
    const ids = rng.int(1, 3) > fish.length ? fish.map((f) => f.id) : fish.slice(0, rng.int(1, 3)).map((f) => f.id);
    const stale = getActiveHand(ctx, U);
    try {
      return bjOutcomeDelta('bj:fish', startFish(ctx, U, ids), 0, staleSettlement(stale?.id));
    } catch (err) {
      if (err instanceof BlackjackError) {
        const st = staleSettlement(stale?.id);
        return st ? { ...st, name: 'bj:fish (stale settled, stake refused)' } : ok('bj:fish', { failed: true });
      }
      throw err;
    }
  };
  const bjAct = (): OpResult => {
    const hand = getActiveHand(ctx, U);
    if (!hand) return ok('bj:act', { failed: true });
    const action: BjAction = rng.pick(['hit', 'stand', 'double'] as const);
    const extra = action === 'double' && hand.stakeType === 'coins' ? hand.stakeValue : 0;
    try {
      const o = act(ctx, U, hand.id, action);
      const doubled = o.hand.state.doubled && extra > 0 ? extra : 0;
      return ok(`bj:${action}`, { coins: (o.finished ? o.hand.payout : 0) - doubled, fishOut: o.finished ? settledFishOut(o.hand) : 0 });
    } catch (err) {
      if (err instanceof BlackjackError) return ok(`bj:${action}`, { failed: true });
      throw err;
    }
  };
  const expire = (): OpResult => {
    const hand = getActiveHand(ctx, U);
    ctx.clock.advance(BALANCE.blackjack.timeoutMs + 1);
    if (!hand) return ok('bj:expire', { failed: true });
    const o = expireHand(ctx, hand.id);
    if (!o) return ok('bj:expire', { failed: true });
    return ok('bj:expire', { coins: o.hand.payout, fishOut: settledFishOut(o.hand) });
  };
  const shop = (): OpResult => {
    const id = rng.pick(['bait-worm', 'energy-drink', 'cage-upgrade'] as const);
    const r = buy(ctx, U, id, id === 'cage-upgrade' ? 1 : rng.int(1, 4));
    return r.ok ? ok(`buy:${id}`, { coins: -r.spent }) : ok(`buy:${id}`, { failed: true });
  };
  const take = (): OpResult => {
    const currency = rng.pick(['coins', 'pearls'] as const);
    const r = takeCurrency(ctx, 'admin', U, currency, rng.int(1, 60));
    return ok(`take:${currency}`, currency === 'coins' ? { coins: -r.taken } : { pearls: -r.taken });
  };
  const give = (): OpResult => {
    // goes through grantReward → accounted by the ledger
    giveReward(ctx, 'admin', U, rng.pick(['coins', 'pearls'] as const), undefined, rng.int(5, 40));
    return ok('give');
  };
  const fish = (): OpResult => {
    ctx.clock.advance(10 * 60_000); // some energy back
    const out = playCast(ctx, U, { reactionMs: rng.int(100, 2600), reelAccuracy: 0.8, rng, location: 'pond' });
    if (!out.ok) return ok(`fish:${out.error.code}`, { failed: true });
    const s = out.step;
    if (s.kind === 'caught') return ok('fish:caught', { fishIn: 1, pearls: s.result.pearls });
    if (s.kind === 'junk') return ok('fish:junk', { coins: s.coins });
    if (s.kind === 'treasure') return ok('fish:treasure', { coins: s.coins, pearls: s.pearls });
    return ok(`fish:${s.kind}`);
  };
  return [sell, chest, bjCoins, bjFish, bjAct, bjAct, expire, shop, take, give, fish, fish];
}

function assertConsistent(game: Game, label: string): void {
  const { ctx } = game;
  const b = getBalance(ctx, U);
  expect(b.coins, `${label}: coins`).toBeGreaterThanOrEqual(0);
  expect(b.pearls, `${label}: pearls`).toBeGreaterThanOrEqual(0);
  const staked = listCaughtFish(ctx, U, { includeStaked: true })
    .filter((f) => f.staked === 1)
    .map((f) => f.id)
    .sort((a, c) => a - c);
  const hand = getActiveHand(ctx, U);
  expect(staked, `${label}: staked fish belong to the active hand`).toEqual(hand?.stakeType === 'fish' ? [...hand.stakedFish].sort((a, c) => a - c) : []);
  for (const q of ['bait-worm', 'energy-drink']) expect(getConsumableQty(ctx, U, q)).toBeGreaterThanOrEqual(0);
}

async function setup(seed: number): Promise<Game> {
  const game = await createGame({ seed });
  ensurePlayerReady(game.ctx, U, 'tight');
  // tight balances: a little of everything
  giveReward(game.ctx, 'admin', U, 'coins', undefined, 120);
  giveReward(game.ctx, 'admin', U, 'pearls', undefined, 25);
  for (let i = 0; i < 6; i++) playCast(game.ctx, U, { reactionMs: 300, reelAccuracy: 1, rng: seededRng(seed + i), location: 'pond' });
  return game;
}

describe('concurrency: interleaved sell / chest / blackjack / shop / admin take on one player', () => {
  it('never goes negative and reconciles every coin, pearl and fish across 120 seeded random orders', async () => {
    const succeeded = new Map<string, number>();
    for (let seed = 1; seed <= 120; seed++) {
      resetGlobals();
      ledger.length = 0;
      const game = await setup(seed);
      const { ctx } = game;
      const rng = seededRng(seed * 7919);
      const ops = makeOps(game, rng);
      for (let step = 0; step < 40; step++) {
        const before = getBalance(ctx, U);
        const fishBefore = countCaughtFish(ctx, U, true);
        const mark = ledger.length;
        const r = rng.pick(ops)();
        const label = `seed ${seed} step ${step} ${r.name}`;
        const kind = r.name.split(' ')[0]!.replace(/×\d+$/, '');
        if (!r.failed) succeeded.set(kind, (succeeded.get(kind) ?? 0) + 1);
        const after = getBalance(ctx, U);
        const granted = ledgerSince(mark, U);
        if (r.failed) {
          // a rejected operation changes nothing (no partial spend)
          expect(after, `${label}: rejected op left balances untouched`).toEqual(before);
          expect(countCaughtFish(ctx, U, true)).toBe(fishBefore);
        } else {
          expect(after.coins - before.coins, `${label}: coins reconcile`).toBe(r.coins + granted.coins);
          expect(after.pearls - before.pearls, `${label}: pearls reconcile`).toBe(r.pearls + granted.pearls);
          expect(countCaughtFish(ctx, U, true), `${label}: fish reconcile`).toBe(fishBefore - r.fishOut + r.fishIn);
        }
        assertConsistent(game, label);
      }
    }
    // every kind of operation really happened (and not only as rejections)
    for (const k of ['sell:all', 'sell:fish', 'chest:wood', 'chest:silver', 'bj:coins', 'bj:fish', 'bj:hit', 'bj:stand', 'bj:double', 'bj:expire', 'buy:bait-worm', 'buy:energy-drink', 'take:coins', 'take:pearls', 'fish:caught']) {
      expect(succeeded.get(k) ?? 0, k).toBeGreaterThan(0);
    }
  }, 120_000);

  it('bursts of concurrent interactions (Promise.all with random yields) end in a consistent, non-negative state', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      resetGlobals();
      ledger.length = 0;
      const game = await setup(1000 + seed);
      const { ctx } = game;
      const rng = seededRng(seed);
      const ops = makeOps(game, rng);
      const start = getBalance(ctx, U);
      const fishStart = countCaughtFish(ctx, U, true);
      const mark = ledger.length;
      const tasks = Array.from({ length: 30 }, () => rng.pick(ops));
      const results = await Promise.all(
        tasks.map(async (op) => {
          for (let y = rng.int(0, 3); y > 0; y--) await Promise.resolve(); // interaction handlers interleave here
          const r = op();
          assertConsistent(game, `burst ${seed} ${r.name}`);
          return r;
        }),
      );
      const done = results.filter((r) => !r.failed);
      const granted = ledgerSince(mark, U);
      const end = getBalance(ctx, U);
      expect(end.coins - start.coins).toBe(done.reduce((s, r) => s + r.coins, 0) + granted.coins);
      expect(end.pearls - start.pearls).toBe(done.reduce((s, r) => s + r.pearls, 0) + granted.pearls);
      expect(countCaughtFish(ctx, U, true)).toBe(fishStart + done.reduce((s, r) => s + r.fishIn - r.fishOut, 0));
    }
  }, 120_000);

  it('blackjack fish stake + «sell all» never sells the staked fish; settlement returns or removes them exactly once', async () => {
    const game = await createGame({ seed: 5 });
    const { ctx } = game;
    ensurePlayerReady(ctx, U);
    let caught = 0;
    for (let i = 0; caught < 6 && i < 40; i++) {
      ctx.clock.advance(5 * 60_000);
      const out = playCast(ctx, U, { reactionMs: 200, reelAccuracy: 1, rng: seededRng(i), location: 'pond' });
      if (out.ok && out.step.kind === 'caught') caught++;
    }
    const fish = listStakeableFish(ctx, U).slice(-3); // cheapest three
    const ids = fish.map((f) => f.id);
    const stakeValue = fish.reduce((s, f) => s + f.value, 0);
    expect(stakeValue).toBeGreaterThanOrEqual(BALANCE.blackjack.minBet);
    // a shoe where the player has 20 and the dealer 20 → push after stand (fish go back to the cage)
    const c = (rank: Card['rank']): Card => ({ rank, suit: '♠' });
    const o = startFish(ctx, U, ids, { deck: [c('K'), c('Q'), c('K'), c('Q'), c('5'), c('5'), c('5')] });
    expect(o.finished).toBe(false);
    // concurrent-looking sells while the hand is open
    const sold = [sellFish(ctx, U, { kind: 'all' }), sellFish(ctx, U, { kind: 'fish', fishId: ids[0]! }), sellFish(ctx, U, { kind: 'rarity', rarity: 'common' })];
    expect(sold[1]!.count).toBe(0);
    expect(listCaughtFish(ctx, U, { includeStaked: true }).map((f) => f.id).sort()).toEqual([...ids].sort());
    expect(listStakeableFish(ctx, U)).toEqual([]);
    // double-click stand: settles once
    const end = act(ctx, U, o.hand.id, 'stand');
    expect(end.hand.state.result).toBe('push');
    expect(() => act(ctx, U, o.hand.id, 'stand')).toThrow(BlackjackError);
    expect(expireHand(ctx, o.hand.id)).toBeNull();
    expect(listStakeableFish(ctx, U).map((f) => f.id).sort()).toEqual([...ids].sort());
    // now they can be sold normally
    const coins = getBalance(ctx, U).coins;
    const r = sellFish(ctx, U, { kind: 'all' });
    expect(r.count).toBe(3);
    expect(getBalance(ctx, U).coins).toBeGreaterThanOrEqual(coins + stakeValue);
    expect(countCaughtFish(ctx, U, true)).toBe(0);
  });

  it('two chest opens racing for pearls that cover only one: exactly one succeeds', async () => {
    const game = await createGame({ seed: 9 });
    const { ctx } = game;
    ensurePlayerReady(ctx, U);
    giveReward(ctx, 'admin', U, 'pearls', undefined, BALANCE.chests.prices.wood + 5);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => openChests(ctx, U, 'wood', 1)),
      Promise.resolve().then(() => openChests(ctx, U, 'wood', 1)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ChestError);
    expect(getBalance(ctx, U).pearls).toBeGreaterThanOrEqual(0);
  });

  it('a coin stake and a shop buy racing for the same coins: the loser is rejected, nothing goes negative', async () => {
    const game = await createGame({ seed: 11 });
    const { ctx } = game;
    ensurePlayerReady(ctx, U);
    giveReward(ctx, 'admin', U, 'coins', undefined, 100);
    const results = await Promise.allSettled([
      Promise.resolve().then(() => startCoins(ctx, U, 100)),
      Promise.resolve().then(() => {
        const r = buy(ctx, U, 'energy-drink', 50);
        if (!r.ok) throw new Error(r.reason);
        return r;
      }),
      Promise.resolve().then(() => takeCurrency(ctx, 'admin', U, 'coins', 1000)),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
    expect(getBalance(ctx, U).coins).toBe(0);
    const hand = getActiveHand(ctx, U);
    if (hand) {
      // the running hand can still be finished; doubling is refused for lack of coins
      expect(() => act(ctx, U, hand.id, 'double')).toThrow(BlackjackError);
      let o = act(ctx, U, hand.id, handValue(hand.state.player).total < 17 ? 'hit' : 'stand');
      while (!o.finished) o = act(ctx, U, hand.id, 'stand');
    }
    expect(getBalance(ctx, U).coins).toBeGreaterThanOrEqual(0);
  });
});
