// Blackjack service (spec §12): stakes, limits, persistence in blackjack_hands, settlement, timeout recovery.
// Timeout/recovery: every action refreshes expires_at = now + BALANCE.blackjack.timeoutMs. Expired active hands are
// auto-stood by `expireHand` / `expireStale` — called by the discord layer's in-memory timer (which also edits the message)
// and by the DB-driven scheduler job `blackjack-expire` (every minute, also on startup → restart recovery; it has no
// Discord client, so it only settles in the DB; a later button press on the stale message shows the final table).
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { dayKey } from '../core/time.js';
import { prepare } from '../db/database.js';
import { deleteCaughtFish, getCaughtFish, listCaughtFish, setFishStaked, type CaughtFishRow } from '../db/repos/inventory.js';
import { requirePlayer, updatePlayer } from '../db/repos/players.js';
import { InsufficientFundsError, addCoins, getBalance, spendCoins } from '../db/repos/wallet.js';
import {
  applyAction,
  canDouble,
  createShoe,
  dealHand,
  decodeCards,
  encodeCards,
  maxBet,
  payoutFor,
  playDealer,
  type BjAction,
  type BjResult,
  type BjStakeType,
  type BjState,
  type Card,
} from '../game/blackjack.js';
import { getOrCreatePlayer } from './player.js';

/** User-facing (Russian) blackjack error; nothing was changed when it is thrown. */
export class BlackjackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlackjackError';
  }
}

interface HandRow {
  id: number;
  user_id: string;
  stake_type: BjStakeType;
  stake_value: number;
  staked_fish: string;
  deck: string;
  player_cards: string;
  dealer_cards: string;
  doubled: number;
  status: 'active' | 'finished';
  result: BjResult | null;
  payout: number;
  created_at: number;
  expires_at: number;
  channel_id: string | null;
  message_id: string | null;
}

export interface BjHand {
  id: number;
  userId: string;
  stakeType: BjStakeType;
  /** coins bet (before doubling) or total value of the staked fish */
  stakeValue: number;
  stakedFish: number[];
  state: BjState;
  status: 'active' | 'finished';
  /** coins paid out at settlement (0 while active, and for a fish push — the fish is returned instead) */
  payout: number;
  createdAt: number;
  expiresAt: number;
  channelId: string | null;
  messageId: string | null;
}

export interface BjOutcome {
  hand: BjHand;
  finished: boolean;
  /** payout − total staked value (0 while active; 0 for a push) */
  net: number;
  /** the "Удвоить" button is allowed right now (coin stake, 2 cards, enough coins) */
  canDouble: boolean;
  /** hands left today after this one */
  handsLeft: number;
  /** the hand was settled by the timeout auto-stand */
  autoStand: boolean;
  notices: Notice[];
}

export type BjStake = { type: 'coins'; amount: number } | { type: 'fish'; fishIds: number[] };

/** Test hook: a fixed shoe (drawn from the front) instead of a freshly shuffled one. */
export interface BjStartOptions {
  deck?: Card[];
}

const T = BALANCE.blackjack;

function toHand(r: HandRow): BjHand {
  return {
    id: r.id,
    userId: r.user_id,
    stakeType: r.stake_type,
    stakeValue: r.stake_value,
    stakedFish: JSON.parse(r.staked_fish) as number[],
    state: {
      deck: decodeCards(r.deck),
      player: decodeCards(r.player_cards),
      dealer: decodeCards(r.dealer_cards),
      doubled: r.doubled === 1,
      result: r.result,
    },
    status: r.status,
    payout: r.payout,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    channelId: r.channel_id,
    messageId: r.message_id,
  };
}

function getRow(ctx: GameContext, handId: number): HandRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM blackjack_hands WHERE id = ?').get(handId) as HandRow | undefined;
}

function getActiveRow(ctx: GameContext, userId: string): HandRow | undefined {
  return prepare(ctx.db, "SELECT * FROM blackjack_hands WHERE user_id = ? AND status = 'active'").get(userId) as HandRow | undefined;
}

export function getHand(ctx: GameContext, handId: number): BjHand | undefined {
  const r = getRow(ctx, handId);
  return r ? toHand(r) : undefined;
}

export function getActiveHand(ctx: GameContext, userId: string): BjHand | undefined {
  const r = getActiveRow(ctx, userId);
  return r ? toHand(r) : undefined;
}

/** Hands already played today (server tz). */
function handsToday(ctx: GameContext, userId: string): number {
  const p = requirePlayer(ctx, userId);
  return p.bj_day_key === dayKey(ctx.clock.now(), ctx.config.timezone) ? p.bj_hands : 0;
}

export function handsLeftToday(ctx: GameContext, userId: string): number {
  getOrCreatePlayer(ctx, userId);
  return Math.max(0, T.handsPerDay - handsToday(ctx, userId));
}

/** Stake limits for the player: [min, max]. */
export function betLimits(ctx: GameContext, userId: string): { min: number; max: number } {
  return { min: T.minBet, max: maxBet(getOrCreatePlayer(ctx, userId).level) };
}

/** Up to BALANCE.blackjack.maxFishOptions most valuable unstaked fish (for the select menu). */
export function listStakeableFish(ctx: GameContext, userId: string, limit: number = T.maxFishOptions): CaughtFishRow[] {
  return listCaughtFish(ctx, userId, { orderBy: 'value_desc', limit });
}

/** Stores where the table message lives (lets the timer path edit it). */
export function setHandMessage(ctx: GameContext, handId: number, channelId: string, messageId: string): void {
  prepare(ctx.db, 'UPDATE blackjack_hands SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, handId);
}

function canDoubleNow(ctx: GameContext, hand: BjHand): boolean {
  if (hand.status !== 'active' || !canDouble(hand.state, hand.stakeType)) return false;
  return getBalance(ctx, hand.userId).coins >= hand.stakeValue;
}

function spendOrFail(ctx: GameContext, userId: string, amount: number): void {
  try {
    spendCoins(ctx, userId, amount);
  } catch (err) {
    if (err instanceof InsufficientFundsError) {
      throw new BlackjackError(`Не хватает монет: нужно 🪙 ${err.required}, у тебя 🪙 ${err.available}.`);
    }
    throw err;
  }
}

interface Settlement {
  payout: number;
  net: number;
}

/**
 * Settles a finished state inside the caller's transaction. Guarded by `status = 'active'` so a hand pays out exactly once.
 * Coins: payout = floor(total stake × multiplier). Fish: lose/bust → fish deleted; win/blackjack → fish deleted and
 * coins = floor(value × multiplier); push → fish unstaked (back to the садок).
 */
function settleRow(ctx: GameContext, row: HandRow, state: BjState): Settlement {
  const result = state.result;
  if (!result) throw new Error('blackjack: settling an unfinished hand');
  const fishIds = JSON.parse(row.staked_fish) as number[];
  const totalStake = row.stake_value * (state.doubled ? 2 : 1);
  let payout = 0;
  let net: number;
  if (row.stake_type === 'fish' && result === 'push') {
    setFishStaked(ctx, row.user_id, fishIds, false);
    net = 0;
  } else {
    if (row.stake_type === 'fish') deleteCaughtFish(ctx, row.user_id, fishIds);
    payout = payoutFor(totalStake, result);
    net = payout - totalStake;
  }
  const r = prepare(
    ctx.db,
    "UPDATE blackjack_hands SET status = 'finished', result = ?, payout = ?, deck = ?, player_cards = ?, dealer_cards = ?, doubled = ? WHERE id = ? AND status = 'active'",
  ).run(result, payout, encodeCards(state.deck), encodeCards(state.player), encodeCards(state.dealer), state.doubled ? 1 : 0, row.id);
  if (r.changes === 0) throw new BlackjackError('Эта раздача уже завершена.');
  if (payout > 0) addCoins(ctx, row.user_id, payout);
  return { payout, net };
}

function saveProgress(ctx: GameContext, row: HandRow, state: BjState, expiresAt: number): void {
  prepare(
    ctx.db,
    "UPDATE blackjack_hands SET deck = ?, player_cards = ?, dealer_cards = ?, doubled = ?, expires_at = ? WHERE id = ? AND status = 'active'",
  ).run(encodeCards(state.deck), encodeCards(state.player), encodeCards(state.dealer), state.doubled ? 1 : 0, expiresAt, row.id);
}

function finishEvents(ctx: GameContext, hand: BjHand, net: number): Notice[] {
  if (hand.status !== 'finished' || !hand.state.result) return [];
  return ctx.bus.emit({ type: 'blackjack_finished', userId: hand.userId, result: hand.state.result, net, stakeType: hand.stakeType }, ctx);
}

function outcome(ctx: GameContext, handId: number, net: number, autoStand: boolean, notices: Notice[]): BjOutcome {
  const hand = getHand(ctx, handId)!;
  const finished = hand.status === 'finished';
  return {
    hand,
    finished,
    net: finished ? net : 0,
    canDouble: canDoubleNow(ctx, hand),
    handsLeft: Math.max(0, T.handsPerDay - handsToday(ctx, hand.userId)),
    autoStand,
    notices,
  };
}

/**
 * Starts a hand. Pearls can never be staked. Validates limits (min, max 100 + 50×level, 20 hands/day, one active hand),
 * takes the stake in the same transaction (coins spent / fish marked staked), deals, and settles a natural immediately.
 */
export function start(ctx: GameContext, userId: string, stake: BjStake, opts: BjStartOptions = {}): BjOutcome {
  const type = (stake as { type: string }).type;
  if (type !== 'coins' && type !== 'fish') throw new BlackjackError('Ставить можно только монеты или рыбу. Жемчуг ставить нельзя 🐚🚫');

  getOrCreatePlayer(ctx, userId);
  const pre: Notice[] = [];
  // an expired hand still marked active (timer lost, job not yet run) is auto-stood first
  const stale = getActiveRow(ctx, userId);
  if (stale && stale.expires_at <= ctx.clock.now()) {
    const out = expireHand(ctx, stale.id);
    if (out) pre.push(...out.notices);
  }

  let net = 0;
  const handId = ctx.db.transaction((): number => {
    const now = ctx.clock.now();
    const player = requirePlayer(ctx, userId);
    if (getActiveRow(ctx, userId)) throw new BlackjackError('У тебя уже идёт раздача — доиграй её 🃏');
    const today = dayKey(now, ctx.config.timezone);
    const played = player.bj_day_key === today ? player.bj_hands : 0;
    if (played >= T.handsPerDay) throw new BlackjackError(`Лимит на сегодня исчерпан: ${T.handsPerDay} раздач в сутки. Приходи завтра!`);
    const max = maxBet(player.level);

    let stakeValue: number;
    let fishIds: number[] = [];
    if (stake.type === 'coins') {
      stakeValue = stake.amount;
      if (!Number.isInteger(stakeValue) || stakeValue < T.minBet) throw new BlackjackError(`Минимальная ставка — 🪙 ${T.minBet}.`);
      if (stakeValue > max) throw new BlackjackError(`Максимальная ставка на твоём уровне — 🪙 ${max}.`);
      spendOrFail(ctx, userId, stakeValue);
    } else {
      fishIds = [...new Set(stake.fishIds)];
      if (fishIds.length === 0) throw new BlackjackError('Выбери хотя бы одну рыбу.');
      if (fishIds.length > T.maxFishOptions) throw new BlackjackError(`Можно поставить не больше ${T.maxFishOptions} рыб.`);
      stakeValue = 0;
      for (const id of fishIds) {
        const f = getCaughtFish(ctx, id);
        if (!f || f.user_id !== userId) throw new BlackjackError('Этой рыбы нет в твоём садке.');
        if (f.staked) throw new BlackjackError('Эта рыба уже на кону.');
        stakeValue += f.value;
      }
      if (stakeValue < T.minBet) throw new BlackjackError(`Минимальная ставка — 🪙 ${T.minBet} (оценка рыбы: 🪙 ${stakeValue}).`);
      if (stakeValue > max) throw new BlackjackError(`Максимальная ставка на твоём уровне — 🪙 ${max} (оценка рыбы: 🪙 ${stakeValue}).`);
      setFishStaked(ctx, userId, fishIds, true);
    }

    updatePlayer(ctx, userId, { bj_day_key: today, bj_hands: played + 1 });
    const state = dealHand(opts.deck ?? createShoe(ctx.rng));
    let id: number;
    try {
      const r = prepare(
        ctx.db,
        "INSERT INTO blackjack_hands (user_id, stake_type, stake_value, staked_fish, deck, player_cards, dealer_cards, doubled, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)",
      ).run(userId, stake.type, stakeValue, JSON.stringify(fishIds), encodeCards(state.deck), encodeCards(state.player), encodeCards(state.dealer), now, now + T.timeoutMs);
      id = Number(r.lastInsertRowid);
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new BlackjackError('У тебя уже идёт раздача — доиграй её 🃏');
      throw err;
    }
    if (state.result) net = settleRow(ctx, getRow(ctx, id)!, state).net;
    return id;
  })();

  const hand = getHand(ctx, handId)!;
  return outcome(ctx, handId, net, false, [...pre, ...finishEvents(ctx, hand, net)]);
}

export function startCoins(ctx: GameContext, userId: string, amount: number, opts?: BjStartOptions): BjOutcome {
  return start(ctx, userId, { type: 'coins', amount }, opts);
}

export function startFish(ctx: GameContext, userId: string, fishIds: number[], opts?: BjStartOptions): BjOutcome {
  return start(ctx, userId, { type: 'fish', fishIds }, opts);
}

/**
 * Player action on their active hand. Double spends another stake (coin stakes, first two cards only).
 * A hand whose timeout already passed is auto-stood instead of applying the action.
 */
export function act(ctx: GameContext, userId: string, handId: number, action: BjAction): BjOutcome {
  let net = 0;
  let autoStand = false;
  ctx.db.transaction((): void => {
    const now = ctx.clock.now();
    const row = getRow(ctx, handId);
    if (!row || row.user_id !== userId) throw new BlackjackError('Это не твоя раздача 🃏');
    if (row.status !== 'active') throw new BlackjackError('Эта раздача уже завершена.');
    const hand = toHand(row);
    let effective = action;
    if (row.expires_at <= now) {
      effective = 'stand';
      autoStand = true;
    }
    if (effective === 'double') {
      if (!canDouble(hand.state, hand.stakeType)) {
        throw new BlackjackError(hand.stakeType === 'fish' ? 'Удвоение доступно только при ставке монетами.' : 'Удвоить можно только на первых двух картах.');
      }
      spendOrFail(ctx, userId, row.stake_value);
    }
    const next = applyAction(hand.state, effective, hand.stakeType);
    if (next.result) net = settleRow(ctx, row, next).net;
    else saveProgress(ctx, row, next, now + T.timeoutMs);
  })();
  const hand = getHand(ctx, handId)!;
  return outcome(ctx, handId, net, autoStand, finishEvents(ctx, hand, net));
}

/** Auto-stands one hand if it is still active and its timeout has passed; null otherwise. Pays out exactly once. */
export function expireHand(ctx: GameContext, handId: number): BjOutcome | null {
  let net = 0;
  const settled = ctx.db.transaction((): boolean => {
    const row = getRow(ctx, handId);
    if (!row || row.status !== 'active' || row.expires_at > ctx.clock.now()) return false;
    net = settleRow(ctx, row, playDealer(toHand(row).state)).net;
    return true;
  })();
  if (!settled) return null;
  const hand = getHand(ctx, handId)!;
  return outcome(ctx, handId, net, true, finishEvents(ctx, hand, net));
}

/** Auto-stands every expired active hand (scheduler job + restart recovery). Returns the settled hands. */
export function expireStale(ctx: GameContext): BjOutcome[] {
  const ids = (
    prepare(ctx.db, "SELECT id FROM blackjack_hands WHERE status = 'active' AND expires_at <= ? ORDER BY id").all(ctx.clock.now()) as { id: number }[]
  ).map((r) => r.id);
  const out: BjOutcome[] = [];
  for (const id of ids) {
    try {
      const o = expireHand(ctx, id);
      if (o) out.push(o);
    } catch (err) {
      console.error(`[blackjack] failed to expire hand ${id}:`, err);
    }
  }
  return out;
}
