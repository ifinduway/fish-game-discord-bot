import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { FakeClock } from '../../src/core/clock.js';
import { createContext } from '../../src/core/context.js';
import type { EventOf } from '../../src/core/events.js';
import { seededRng } from '../../src/core/rng.js';
import { FISH } from '../../src/data/fish.js';
import { openDatabase } from '../../src/db/database.js';
import { addCaughtFish, getCaughtFish, listCaughtFish } from '../../src/db/repos/inventory.js';
import { updatePlayer } from '../../src/db/repos/players.js';
import { getBalance, spendCoins, InsufficientFundsError } from '../../src/db/repos/wallet.js';
import {
  applyAction,
  canDouble,
  cardFromString,
  createShoe,
  dealHand,
  dealerShouldHit,
  handValue,
  isBlackjack,
  payoutFor,
  settle,
  type Card,
} from '../../src/game/blackjack.js';
import blackjackJob from '../../src/scheduler/jobs/blackjack.js';
import {
  BlackjackError,
  act,
  expireStale,
  getActiveHand,
  getHand,
  handsLeftToday,
  listStakeableFish,
  start,
  startCoins,
  startFish,
} from '../../src/services/blackjack.js';
import { getOrCreatePlayer } from '../../src/services/player.js';
import { createTestContext, seedPlayer, type TestContext } from '../helpers.js';

const C = (...codes: string[]): Card[] => codes.map(cardFromString);
/** deck order: player, dealer, player, dealer(hole), then draws */
const NATURAL = C('A♠', '9♥', 'K♦', '7♣', '2♠', '2♥');
const P20_D17 = C('10♠', '10♥', 'Q♦', '7♣', '5♠', '5♥'); // player 20, dealer 17 → stand wins
const P17_D19 = C('10♠', '10♥', '7♦', '9♣', '5♠'); // stand loses
const P20_D20 = C('10♠', 'K♥', 'Q♦', 'Q♣', '5♠'); // stand pushes
const P16_D17 = C('10♠', '10♥', '6♦', '7♣', 'K♠'); // hit → bust
const P11_D17 = C('5♠', '10♥', '6♦', '7♣', 'K♠', '2♥'); // double → 21 → win

function finishedEvents(ctx: TestContext): EventOf<'blackjack_finished'>[] {
  const out: EventOf<'blackjack_finished'>[] = [];
  ctx.bus.on('blackjack_finished', (e) => void out.push(e));
  return out;
}

function seedFish(ctx: TestContext, userId: string, values: number[]): number[] {
  const species = FISH[0]!;
  return values.map((value) =>
    addCaughtFish(ctx, { userId, speciesId: species.id, weight: 1, quality: 1, value, location: species.locations[0] ?? 'pond', caughtAt: ctx.clock.now() }),
  );
}

describe('blackjack engine (pure)', () => {
  it('values aces as 1 or 11', () => {
    expect(handValue(C('A♠', 'A♥', '9♦'))).toEqual({ total: 21, soft: true });
    expect(handValue(C('A♠', 'K♥'))).toEqual({ total: 21, soft: true });
    expect(isBlackjack(C('A♠', 'K♥'))).toBe(true);
    expect(isBlackjack(C('A♠', '5♥', '5♦'))).toBe(false);
    expect(handValue(C('A♠', '9♥', '5♦'))).toEqual({ total: 15, soft: false });
    expect(handValue(C('A♠', 'A♥', 'A♦', 'A♣'))).toEqual({ total: 14, soft: true });
  });

  it('dealer draws below 17 and stands on soft 17', () => {
    expect(dealerShouldHit(C('A♠', '6♥'))).toBe(false); // soft 17
    expect(dealerShouldHit(C('10♠', '7♥'))).toBe(false);
    expect(dealerShouldHit(C('A♠', '5♥'))).toBe(true); // soft 16
    expect(dealerShouldHit(C('10♠', '6♥'))).toBe(true);
    // dealer A+6 is not drawn to after a stand
    const s = applyAction(dealHand(C('10♠', 'A♥', '8♦', '6♣', '4♠')), 'stand', 'coins');
    expect(s.dealer).toHaveLength(2);
    expect(s.result).toBe('win'); // 18 vs soft 17
  });

  it('natural blackjack settles on the deal and pays 3:2', () => {
    const s = dealHand(NATURAL);
    expect(s.result).toBe('blackjack');
    expect(payoutFor(100, 'blackjack')).toBe(250);
    expect(payoutFor(100, 'win')).toBe(200);
    expect(payoutFor(100, 'push')).toBe(100);
    expect(payoutFor(100, 'lose')).toBe(0);
    expect(payoutFor(100, 'bust')).toBe(0);
    expect(dealHand(C('A♠', 'A♥', 'K♦', 'Q♣')).result).toBe('push'); // both naturals
    expect(dealHand(C('9♠', 'A♥', 'K♦', 'Q♣')).result).toBe('lose'); // dealer natural
  });

  it('double draws exactly one card and stands', () => {
    const s0 = dealHand(P11_D17);
    expect(canDouble(s0, 'coins')).toBe(true);
    expect(canDouble(s0, 'fish')).toBe(false);
    const s = applyAction(s0, 'double', 'coins');
    expect(s.player).toHaveLength(3);
    expect(s.doubled).toBe(true);
    expect(s.result).toBe('win');
    expect(s.deck).toHaveLength(s0.deck.length - 1);
    expect(() => applyAction(s0, 'double', 'fish')).toThrow();
    const hit = applyAction(dealHand(C('2♠', '10♥', '3♦', '7♣', '4♠', '5♠')), 'hit', 'coins');
    expect(canDouble(hit, 'coins')).toBe(false);
  });

  it('player bust ends the hand without dealer draws', () => {
    const s = applyAction(dealHand(P16_D17), 'hit', 'coins');
    expect(s.result).toBe('bust');
    expect(s.dealer).toHaveLength(2);
    expect(settle(C('10♠', '6♥', 'K♦'), C('10♠', '10♥', '5♦'))).toBe('bust');
    expect(settle(C('10♠', '6♥'), C('10♠', '6♥', 'K♦'))).toBe('win');
  });

  it('builds a shuffled 6-deck shoe deterministically', () => {
    const a = createShoe(seededRng(1));
    const b = createShoe(seededRng(1));
    expect(a).toHaveLength(52 * BALANCE.blackjack.decks);
    expect(a).toEqual(b);
    expect(a.filter((c) => c.rank === 'A' && c.suit === '♠')).toHaveLength(BALANCE.blackjack.decks);
  });
});

describe('blackjack service — coins', () => {
  it('natural pays 2.5× immediately', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const ev = finishedEvents(ctx);
    const o = startCoins(ctx, 'u1', 100, { deck: NATURAL });
    expect(o.finished).toBe(true);
    expect(o.hand.state.result).toBe('blackjack');
    expect(getBalance(ctx, 'u1').coins).toBe(1150);
    expect(ev).toEqual([{ type: 'blackjack_finished', userId: 'u1', result: 'blackjack', net: 150, stakeType: 'coins' }]);
    expect(getActiveHand(ctx, 'u1')).toBeUndefined();
  });

  it('stake is spent at start; stand win pays 2×', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const ev = finishedEvents(ctx);
    const o = startCoins(ctx, 'u1', 100, { deck: P20_D17 });
    expect(o.finished).toBe(false);
    expect(getBalance(ctx, 'u1').coins).toBe(900);
    const r = act(ctx, 'u1', o.hand.id, 'stand');
    expect(r.hand.state.result).toBe('win');
    expect(r.hand.payout).toBe(200);
    expect(getBalance(ctx, 'u1').coins).toBe(1100);
    expect(ev.map((e) => e.net)).toEqual([100]);
  });

  it('double doubles the stake and draws one card', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const o = startCoins(ctx, 'u1', 100, { deck: P11_D17 });
    expect(o.canDouble).toBe(true);
    const r = act(ctx, 'u1', o.hand.id, 'double');
    expect(r.hand.state.doubled).toBe(true);
    expect(r.hand.state.player).toHaveLength(3);
    expect(r.hand.state.result).toBe('win');
    expect(r.hand.payout).toBe(400);
    expect(r.net).toBe(200);
    expect(getBalance(ctx, 'u1').coins).toBe(1200);
  });

  it('double without enough coins → friendly error, no state change', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 100 });
    const o = startCoins(ctx, 'u1', 100, { deck: P11_D17 });
    expect(o.canDouble).toBe(false);
    expect(() => act(ctx, 'u1', o.hand.id, 'double')).toThrow(/Не хватает монет/);
    const h = getHand(ctx, o.hand.id)!;
    expect(h.status).toBe('active');
    expect(h.state.player).toHaveLength(2);
    expect(h.state.doubled).toBe(false);
    expect(getBalance(ctx, 'u1').coins).toBe(0);
  });

  it('player bust loses the stake', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const ev = finishedEvents(ctx);
    const o = startCoins(ctx, 'u1', 100, { deck: P16_D17 });
    const r = act(ctx, 'u1', o.hand.id, 'hit');
    expect(r.hand.state.result).toBe('bust');
    expect(getBalance(ctx, 'u1').coins).toBe(900);
    expect(ev[0]).toMatchObject({ result: 'bust', net: -100 });
  });

  it('only the owner can act', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    seedPlayer(ctx, 'u2', { coins: 1000 });
    const o = startCoins(ctx, 'u1', 100, { deck: P20_D17 });
    expect(() => act(ctx, 'u2', o.hand.id, 'stand')).toThrow(BlackjackError);
    expect(getHand(ctx, o.hand.id)!.status).toBe('active');
  });
});

describe('blackjack service — fish', () => {
  it('stakes fish (staked=1, hidden from the садок) and push returns them', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const ids = seedFish(ctx, 'u1', [30, 40]);
    const o = startFish(ctx, 'u1', ids, { deck: P20_D20 });
    expect(o.hand.stakeValue).toBe(70);
    expect(ids.every((id) => getCaughtFish(ctx, id)!.staked === 1)).toBe(true);
    expect(listStakeableFish(ctx, 'u1')).toHaveLength(0);
    const r = act(ctx, 'u1', o.hand.id, 'stand');
    expect(r.hand.state.result).toBe('push');
    expect(r.net).toBe(0);
    expect(ids.every((id) => getCaughtFish(ctx, id)!.staked === 0)).toBe(true);
    expect(listCaughtFish(ctx, 'u1')).toHaveLength(2);
    expect(getBalance(ctx, 'u1').coins).toBe(0);
  });

  it('lose deletes the fish', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const ids = seedFish(ctx, 'u1', [50]);
    const ev = finishedEvents(ctx);
    const o = startFish(ctx, 'u1', ids, { deck: P17_D19 });
    act(ctx, 'u1', o.hand.id, 'stand');
    expect(getCaughtFish(ctx, ids[0]!)).toBeUndefined();
    expect(getBalance(ctx, 'u1').coins).toBe(0);
    expect(ev[0]).toMatchObject({ result: 'lose', net: -50, stakeType: 'fish' });
  });

  it('win deletes the fish and pays value × 2 in coins', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const ids = seedFish(ctx, 'u1', [45, 15]);
    const o = startFish(ctx, 'u1', ids, { deck: P20_D17 });
    const r = act(ctx, 'u1', o.hand.id, 'stand');
    expect(r.hand.state.result).toBe('win');
    expect(ids.map((id) => getCaughtFish(ctx, id))).toEqual([undefined, undefined]);
    expect(getBalance(ctx, 'u1').coins).toBe(120);
    expect(r.net).toBe(60);
  });

  it('fish stakes cannot double; foreign / staked fish rejected', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    seedPlayer(ctx, 'u2');
    const mine = seedFish(ctx, 'u1', [50]);
    const theirs = seedFish(ctx, 'u2', [50]);
    expect(() => startFish(ctx, 'u1', theirs)).toThrow(BlackjackError);
    const o = startFish(ctx, 'u1', mine, { deck: P11_D17 });
    expect(o.canDouble).toBe(false);
    expect(() => act(ctx, 'u1', o.hand.id, 'double')).toThrow(/монетами/);
    expect(getBalance(ctx, 'u1').coins).toBe(1000);
  });

  it('fish value outside [min, max] is rejected', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const small = seedFish(ctx, 'u1', [9]);
    const big = seedFish(ctx, 'u1', [100, 51]); // 151 > 150 at level 1
    expect(() => startFish(ctx, 'u1', small)).toThrow(/Минимальная/);
    expect(() => startFish(ctx, 'u1', big)).toThrow(/Максимальная/);
    expect(listCaughtFish(ctx, 'u1').every((f) => f.staked === 0)).toBe(true);
  });
});

describe('blackjack limits', () => {
  it('min bet and max bet by level', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 10_000 });
    expect(() => startCoins(ctx, 'u1', BALANCE.blackjack.minBet - 1)).toThrow(/Минимальная/);
    expect(() => startCoins(ctx, 'u1', 151)).toThrow(/Максимальная/);
    expect(getBalance(ctx, 'u1').coins).toBe(10_000);
    updatePlayer(ctx, 'u1', { level: 3 });
    expect(startCoins(ctx, 'u1', 250, { deck: NATURAL }).finished).toBe(true);
  });

  it('the 21st hand of the day is rejected; the limit resets the next day', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 100_000 });
    for (let n = 0; n < BALANCE.blackjack.handsPerDay; n++) startCoins(ctx, 'u1', 10, { deck: NATURAL });
    expect(handsLeftToday(ctx, 'u1')).toBe(0);
    const coins = getBalance(ctx, 'u1').coins;
    expect(() => startCoins(ctx, 'u1', 10, { deck: NATURAL })).toThrow(/Лимит/);
    expect(getBalance(ctx, 'u1').coins).toBe(coins);
    ctx.clock.advance(24 * 3600_000);
    expect(handsLeftToday(ctx, 'u1')).toBe(BALANCE.blackjack.handsPerDay);
    expect(startCoins(ctx, 'u1', 10, { deck: NATURAL }).handsLeft).toBe(BALANCE.blackjack.handsPerDay - 1);
  });

  it('pearls can never be staked', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { pearls: 500 });
    expect(() => start(ctx, 'u1', { type: 'pearls', amount: 50 } as never)).toThrow(/Жемчуг/);
    expect(() => startCoins(ctx, 'u1', 50)).toThrow(/Не хватает монет/);
    expect(getBalance(ctx, 'u1')).toEqual({ coins: 0, pearls: 500 });
  });

  it('only one active hand at a time', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const o = startCoins(ctx, 'u1', 100, { deck: P20_D17 });
    expect(() => startCoins(ctx, 'u1', 100, { deck: P20_D17 })).toThrow(/уже идёт/);
    expect(getBalance(ctx, 'u1').coins).toBe(900);
    act(ctx, 'u1', o.hand.id, 'stand');
    expect(startCoins(ctx, 'u1', 100, { deck: P20_D17 }).finished).toBe(false);
  });
});

describe('blackjack timeout & recovery', () => {
  it('expireStale auto-stands an expired hand exactly once', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const ev = finishedEvents(ctx);
    const o = startCoins(ctx, 'u1', 100, { deck: P20_D17 });
    ctx.clock.advance(BALANCE.blackjack.timeoutMs - 1000);
    expect(expireStale(ctx)).toHaveLength(0);
    ctx.clock.advance(2000);
    const settled = expireStale(ctx);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.autoStand).toBe(true);
    expect(settled[0]!.hand.state.result).toBe('win');
    expect(expireStale(ctx)).toHaveLength(0);
    expect(getBalance(ctx, 'u1').coins).toBe(1100);
    expect(ev).toHaveLength(1);
    expect(() => act(ctx, 'u1', o.hand.id, 'hit')).toThrow(/завершена/);
  });

  it('actions refresh the timeout; a press after expiry counts as stand', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 1000 });
    const o = startCoins(ctx, 'u1', 100, { deck: C('2♠', '10♥', '3♦', '7♣', '4♠', '5♠', '6♠') });
    ctx.clock.advance(50_000);
    const h = act(ctx, 'u1', o.hand.id, 'hit');
    expect(h.finished).toBe(false);
    expect(h.hand.expiresAt).toBe(ctx.clock.now() + BALANCE.blackjack.timeoutMs);
    ctx.clock.advance(50_000);
    expect(expireStale(ctx)).toHaveLength(0);
    ctx.clock.advance(20_000);
    const r = act(ctx, 'u1', o.hand.id, 'hit');
    expect(r.autoStand).toBe(true);
    expect(r.finished).toBe(true);
    expect(r.hand.state.player).toHaveLength(3);
  });

  it('an unfinished hand is settled by the scheduler job after a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wp5-bj-'));
    const path = join(dir, 'bj.db');
    try {
      const clock = new FakeClock(Date.UTC(2026, 0, 5, 9, 0, 0));
      const db1 = openDatabase(path);
      const ctx1 = createContext({ db: db1, clock, rng: seededRng(1), defaultTimezone: 'Europe/Moscow' });
      getOrCreatePlayer(ctx1, 'u1');
      db1.prepare('UPDATE players SET coins = 500 WHERE user_id = ?').run('u1');
      const o = startCoins(ctx1, 'u1', 100, { deck: P17_D19 });
      db1.close(); // "crash"

      clock.advance(5 * 60_000);
      const db2 = openDatabase(path);
      const ctx2 = createContext({ db: db2, clock, rng: seededRng(2), defaultTimezone: 'Europe/Moscow' });
      await blackjackJob.run(ctx2);
      const h = getHand(ctx2, o.hand.id)!;
      expect(h.status).toBe('finished');
      expect(h.state.result).toBe('lose');
      expect(getBalance(ctx2, 'u1').coins).toBe(400);
      await blackjackJob.run(ctx2);
      expect(getBalance(ctx2, 'u1').coins).toBe(400);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('blackjack concurrency', () => {
  it('coin stake + another spend can never overspend', async () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1', { coins: 100 });
    const results = await Promise.allSettled([
      Promise.resolve().then(() => startCoins(ctx, 'u1', 100, { deck: P20_D17 })),
      Promise.resolve().then(() => spendCoins(ctx, 'u1', 60)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InsufficientFundsError);
    expect(getBalance(ctx, 'u1').coins).toBe(0);

    const ctx2 = createTestContext();
    seedPlayer(ctx2, 'u1', { coins: 100 });
    spendCoins(ctx2, 'u1', 60);
    expect(() => startCoins(ctx2, 'u1', 100)).toThrow(BlackjackError);
    expect(getBalance(ctx2, 'u1').coins).toBe(40);
    expect(getActiveHand(ctx2, 'u1')).toBeUndefined();
  });
});
