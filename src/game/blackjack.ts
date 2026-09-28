// Pure blackjack engine (spec §12): 6-deck shoe, soft/hard aces, dealer stands on soft 17, 3:2 blackjack,
// double on the first two cards (coin stakes only), no split / insurance. Cards are drawn from the FRONT of the deck.
import { BALANCE } from '../config/balance.js';
import type { Rng } from '../core/rng.js';
import type { Card, CardRank, CardSuit } from '../render/types.js';

export type { Card } from '../render/types.js';

export type BjResult = 'win' | 'blackjack' | 'lose' | 'push' | 'bust';
export type BjAction = 'hit' | 'stand' | 'double';
export type BjStakeType = 'coins' | 'fish';

export const RANKS: CardRank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS: CardSuit[] = ['♠', '♥', '♦', '♣'];

/** Builds a `decks`-deck shoe and shuffles it (Fisher–Yates) with the given rng. */
export function createShoe(rng: Rng, decks: number = BALANCE.blackjack.decks): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [shoe[i], shoe[j]] = [shoe[j]!, shoe[i]!];
  }
  return shoe;
}

/** Hard value of a card (ace = 1). */
export function cardPoints(card: Card): number {
  if (card.rank === 'A') return 1;
  if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
  return Number(card.rank);
}

/** Best total ≤ 21 if possible; `soft` = an ace is counted as 11. */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardPoints(c);
    if (c.rank === 'A') aces++;
  }
  if (aces > 0 && total + 10 <= 21) return { total: total + 10, soft: true };
  return { total, soft: false };
}

/** Natural: exactly two cards totalling 21. */
export function isBlackjack(cards: readonly Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isBust(cards: readonly Card[]): boolean {
  return handValue(cards).total > 21;
}

/** Dealer draws below 17 and stands on any 17 (soft 17 included). */
export function dealerShouldHit(cards: readonly Card[]): boolean {
  return handValue(cards).total < 17;
}

export interface BjState {
  /** remaining shoe (drawn from the front) */
  deck: Card[];
  player: Card[];
  /** dealer[1] is the hole card while the hand is in progress */
  dealer: Card[];
  doubled: boolean;
  /** null while the hand is in progress */
  result: BjResult | null;
}

function draw(deck: Card[]): Card {
  const c = deck.shift();
  if (!c) throw new Error('blackjack: shoe is empty');
  return c;
}

function clone(s: BjState): BjState {
  return { deck: [...s.deck], player: [...s.player], dealer: [...s.dealer], doubled: s.doubled, result: s.result };
}

/** Final result of finished hands. */
export function settle(player: readonly Card[], dealer: readonly Card[]): BjResult {
  if (isBust(player)) return 'bust';
  const pBj = isBlackjack(player);
  const dBj = isBlackjack(dealer);
  if (pBj && dBj) return 'push';
  if (pBj) return 'blackjack';
  if (dBj) return 'lose';
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  if (d > 21 || p > d) return 'win';
  if (p < d) return 'lose';
  return 'push';
}

/** Deals player, dealer, player, dealer from `deck` (copied). A natural on either side settles immediately. */
export function dealHand(deck: readonly Card[]): BjState {
  const s: BjState = { deck: [...deck], player: [], dealer: [], doubled: false, result: null };
  s.player.push(draw(s.deck));
  s.dealer.push(draw(s.deck));
  s.player.push(draw(s.deck));
  s.dealer.push(draw(s.deck));
  if (isBlackjack(s.player) || isBlackjack(s.dealer)) s.result = settle(s.player, s.dealer);
  return s;
}

/** Dealer plays out (draws while < 17) and the hand is settled. */
export function playDealer(state: BjState): BjState {
  const s = clone(state);
  if (!isBust(s.player)) while (dealerShouldHit(s.dealer)) s.dealer.push(draw(s.deck));
  s.result = settle(s.player, s.dealer);
  return s;
}

/** Double allowed: hand in progress, first two cards, not doubled yet, coin stake. */
export function canDouble(state: BjState, stakeType: BjStakeType): boolean {
  return state.result === null && stakeType === 'coins' && state.player.length === 2 && !state.doubled;
}

/**
 * Applies a player action and returns the new state (input untouched).
 * hit: draw one (bust → finished, 21 → auto-stand); stand: dealer plays; double: draw exactly one, then stand.
 */
export function applyAction(state: BjState, action: BjAction, stakeType: BjStakeType): BjState {
  if (state.result !== null) throw new Error('blackjack: hand already finished');
  if (action === 'double' && !canDouble(state, stakeType)) throw new Error('blackjack: double not allowed');
  const s = clone(state);
  if (action === 'stand') return playDealer(s);
  s.player.push(draw(s.deck));
  if (action === 'double') s.doubled = true;
  if (isBust(s.player)) {
    s.result = 'bust';
    return s;
  }
  if (action === 'double' || handValue(s.player).total === 21) return playDealer(s);
  return s;
}

/** Total returned to the player per unit of stake (stake included): win 2×, blackjack 2.5×, push 1×, lose/bust 0. */
export function payoutMultiplier(result: BjResult): number {
  switch (result) {
    case 'win':
      return BALANCE.blackjack.winPayout;
    case 'blackjack':
      return BALANCE.blackjack.blackjackPayout;
    case 'push':
      return BALANCE.blackjack.pushPayout;
    default:
      return 0;
  }
}

/** Coins returned for a total stake (floored). */
export function payoutFor(totalStake: number, result: BjResult): number {
  return Math.floor(totalStake * payoutMultiplier(result));
}

/** Max stake at a player level: 100 + 50 × level. */
export function maxBet(level: number): number {
  return BALANCE.blackjack.maxBetBase + BALANCE.blackjack.maxBetPerLevel * level;
}

// ── compact persistence ("A♠") ──

export function cardToString(c: Card): string {
  return `${c.rank}${c.suit}`;
}

export function cardFromString(s: string): Card {
  const suit = s.slice(-1) as CardSuit;
  const rank = s.slice(0, -1) as CardRank;
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) throw new Error(`blackjack: bad card '${s}'`);
  return { rank, suit };
}

export function encodeCards(cards: readonly Card[]): string {
  return JSON.stringify(cards.map(cardToString));
}

export function decodeCards(json: string): Card[] {
  return (JSON.parse(json) as string[]).map(cardFromString);
}
