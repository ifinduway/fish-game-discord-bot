// Pure server-boss logic (no db / discord): hp scaling, damage formula, reward tiers, spawn schedule.
import { DateTime } from 'luxon';
import { BALANCE } from '../config/balance.js';
import type { Reward } from '../data/types.js';

/** Cosmetic granted to the top-1 damage dealer of a defeated boss (WP1 catalog id). */
export const BOSS_SLAYER_TITLE = 'title-boss-slayer';
/** Fallback display name when the catalog lacks BOSS_SLAYER_TITLE. */
export const BOSS_SLAYER_TITLE_NAME = 'Гроза боссов';

/** max_hp = hpPerPlayer × max(minPlayers, activePlayers) */
export function computeBossMaxHp(hpPerPlayer: number, activePlayers: number, minPlayers: number = BALANCE.boss.minPlayers): number {
  return Math.max(1, Math.round(hpPerPlayer * Math.max(minPlayers, Math.floor(activePlayers))));
}

export interface DamageInput {
  weight: number;
  quality: number;
  perfect: boolean;
}

/** damage = (damageBase + weight × damagePerKg) × qualityMultiplier × (perfect ? perfectMultiplier : 1), rounded, ≥ 1. */
export function computeBossDamage(d: DamageInput): number {
  const b = BALANCE.boss;
  const qm = BALANCE.fishing.qualityMultipliers;
  const q = Math.max(1, Math.min(qm.length, Math.round(d.quality)));
  const raw = (b.damageBase + Math.max(0, d.weight) * b.damagePerKg) * qm[q - 1]! * (d.perfect ? b.perfectMultiplier : 1);
  return Math.max(1, Math.round(raw));
}

export interface Contribution {
  userId: string;
  damage: number;
}

export interface BossPayout {
  userId: string;
  damage: number;
  /** damage / total damage (0..1) */
  share: number;
  /** 1-based place by damage */
  place: number;
  reward: Reward;
  /** top-1 of a defeated boss (gets the slayer title) */
  slayer: boolean;
}

/** First matching tier (tiers sorted by minShare desc). */
export function rewardTierFor(share: number): { minShare: number; pearls: number; coins: number } {
  const tiers = [...BALANCE.boss.rewardTiers].sort((a, b) => b.minShare - a.minShare);
  return tiers.find((t) => share >= t.minShare) ?? tiers[tiers.length - 1]!;
}

/** Sort contributions: damage desc, userId asc (stable, deterministic). */
export function rankContributions(list: Contribution[]): Contribution[] {
  return list.filter((c) => c.damage > 0).sort((a, b) => b.damage - a.damage || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * Reward distribution. Defeated → tier by contribution share, top-1 is the slayer.
 * Expired → every participant gets the consolation reward.
 */
export function distributeBossRewards(contributions: Contribution[], outcome: 'defeated' | 'expired'): BossPayout[] {
  const ranked = rankContributions(contributions);
  const total = ranked.reduce((s, c) => s + c.damage, 0);
  return ranked.map((c, i) => {
    const share = total > 0 ? c.damage / total : 0;
    if (outcome === 'expired') {
      return {
        userId: c.userId,
        damage: c.damage,
        share,
        place: i + 1,
        reward: { pearls: BALANCE.boss.consolationPearls, coins: BALANCE.boss.consolationCoins },
        slayer: false,
      };
    }
    const tier = rewardTierFor(share);
    return { userId: c.userId, damage: c.damage, share, place: i + 1, reward: { pearls: tier.pearls, coins: tier.coins }, slayer: i === 0 };
  });
}

/** Scheduled spawn instants (ms) around `now`: latest slot ≤ now and next slot > now (weekday/hour in server tz). */
function slotsAround(now: number, tz: string): { prev: number | null; next: number } {
  const { scheduleWeekdays, scheduleHour } = BALANCE.boss;
  const base = DateTime.fromMillis(now, { zone: tz }).startOf('day');
  let prev: number | null = null;
  let next = Number.POSITIVE_INFINITY;
  for (let d = -8; d <= 8; d++) {
    const day = base.plus({ days: d });
    if (!scheduleWeekdays.includes(day.weekday)) continue;
    const t = day.set({ hour: scheduleHour, minute: 0, second: 0, millisecond: 0 }).toMillis();
    if (t <= now) prev = prev === null ? t : Math.max(prev, t);
    else next = Math.min(next, t);
  }
  return { prev, next };
}

/** Latest scheduled spawn instant ≤ now (or null if none within the last 8 days — never happens with a non-empty schedule). */
export function latestBossSlot(now: number, tz: string): number | null {
  return slotsAround(now, tz).prev;
}

/** Next scheduled spawn instant > now. */
export function nextBossSlot(now: number, tz: string): number {
  return slotsAround(now, tz).next;
}

/** Idempotency key of a slot, e.g. '2026-01-06T18'. */
export function bossSlotKey(slotMs: number, tz: string): string {
  return DateTime.fromMillis(slotMs, { zone: tz }).toFormat("yyyy-LL-dd'T'HH");
}
