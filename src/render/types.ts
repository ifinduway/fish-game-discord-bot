// ALL card input types + render function signatures (plan §4.6). Every renderer returns a PNG Buffer.
import type { CosmeticType, GearSlot, Rarity } from '../data/types.js';

export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type CardSuit = '♠' | '♥' | '♦' | '♣';
/** Playing card (reused by game/blackjack.ts). */
export interface Card {
  rank: CardRank;
  suit: CardSuit;
}

export interface ProfileCardData {
  avatarUrl?: string;
  username: string;
  level: number;
  xp: number;
  xpNext: number;
  energy: number;
  maxEnergy: number;
  coins: number;
  pearls: number;
  /** display names (not ids) */
  title?: string;
  frame?: { name: string; color?: string; gradient?: [string, string] };
  background?: { name: string; color?: string; gradient?: [string, string] };
  gear: { slot: GearSlot; name: string; tier: Rarity; upgrade: number }[];
  stats: { label: string; value: string }[];
  collection: { caught: number; total: number };
  seasonPass?: { level: number; max: number };
}

export interface CatchCardData {
  avatarUrl?: string;
  username: string;
  species: { name: string; rarity: Rarity; description: string; emoji?: string };
  /** kg */
  weight: number;
  /** ★1..5 */
  quality: number;
  perfect: boolean;
  /** sell value in coins */
  value: number;
  /** location display name */
  location: string;
  firstOfSpecies: boolean;
  /** new server record for the species */
  record?: boolean;
  seasonal?: boolean;
}

export interface ChestRewardView {
  label: string;
  rarity: Rarity;
  kind: 'coins' | 'item' | 'gear' | 'cosmetic';
  cosmeticType?: CosmeticType;
  /** gear duplicate converted to coins */
  duplicate?: boolean;
}

export interface ChestCardData {
  chest: { name: string; emoji?: string };
  /** one entry per opened chest (multi-open → one summary card, amendment §8.6) */
  rewards: ChestRewardView[];
  /** opens left until the pity guarantee (undefined → chest has no pity) */
  pityLeft?: number;
}

export interface LeaderboardRow {
  rank: number;
  username: string;
  /** preformatted value, e.g. "12,5 кг" */
  value: string;
  userId?: string;
  avatarUrl?: string;
}

export interface LeaderboardCardData {
  title: string;
  subtitle?: string;
  rows: LeaderboardRow[];
  highlightUserId?: string;
}

export interface BossCardData {
  name: string;
  emoji?: string;
  hp: number;
  maxHp: number;
  /** ms epoch */
  expiresAt: number;
  /** location display name */
  location: string;
  status?: 'active' | 'defeated' | 'expired';
  top: { username: string; damage: number }[];
}

export interface BlackjackHandView {
  cards: Card[];
  /** best total (soft aces counted) */
  total: number;
}

export interface BlackjackCardData {
  player: BlackjackHandView;
  dealer: BlackjackHandView;
  /** hide the dealer's hole card (hand in progress) */
  hideDealerHole?: boolean;
  result: 'win' | 'blackjack' | 'lose' | 'push' | 'bust' | null;
  /** e.g. "🪙 150" or "🐟 3 рыбы (🪙 420)" */
  stakeLabel: string;
  /** coins paid out (0 when lost) */
  payout: number;
  username?: string;
}

export interface SeasonSummaryData {
  seasonName: string;
  emoji?: string;
  colors: [string, string];
  categories: { title: string; winners: { username: string; value: string }[] }[];
}

export type RenderProfileCard = (d: ProfileCardData) => Promise<Buffer>;
export type RenderCatchCard = (d: CatchCardData) => Promise<Buffer>;
export type RenderChestCard = (d: ChestCardData) => Promise<Buffer>;
export type RenderLeaderboardCard = (d: LeaderboardCardData) => Promise<Buffer>;
export type RenderBossCard = (d: BossCardData) => Promise<Buffer>;
export type RenderBlackjackCard = (d: BlackjackCardData) => Promise<Buffer>;
export type RenderSeasonSummaryCard = (d: SeasonSummaryData) => Promise<Buffer>;
