// Pure leaderboard definitions & formatting (no db / discord).

export type LeaderboardCategory =
  | 'heaviest_week'
  | 'coins_week'
  | 'rare_week'
  | 'collection'
  | 'pass_level'
  | 'boss_damage_season'
  | 'level'
  | 'casino_week';

export interface LeaderboardCategoryDef {
  id: LeaderboardCategory;
  /** Russian title shown on the card and in the command choices */
  title: string;
  emoji: string;
  /** keyed by week (reset every Monday; top-1 gets BALANCE.weekly.winnerPearls) */
  weekly: boolean;
  /** stats metric for counter-based boards */
  metric?: string;
}

export const LEADERBOARD_CATEGORIES: LeaderboardCategoryDef[] = [
  { id: 'heaviest_week', title: 'Самая тяжёлая рыба недели', emoji: '🐋', weekly: true, metric: 'heaviest_weight' },
  { id: 'coins_week', title: 'Заработано монет за неделю', emoji: '🪙', weekly: true, metric: 'coins_earned' },
  { id: 'rare_week', title: 'Редкие+ за неделю', emoji: '💎', weekly: true, metric: 'rare_plus' },
  { id: 'collection', title: 'Коллекция', emoji: '📖', weekly: false },
  { id: 'pass_level', title: 'Уровень пасса', emoji: '🎫', weekly: false },
  { id: 'boss_damage_season', title: 'Урон по боссам за сезон', emoji: '⚔️', weekly: false, metric: 'boss_damage' },
  { id: 'level', title: 'Уровень игрока', emoji: '⭐', weekly: false },
  { id: 'casino_week', title: 'Казино: чистый выигрыш за неделю', emoji: '🃏', weekly: true, metric: 'bj_net' },
];

export const LEADERBOARD_BY_ID: Record<LeaderboardCategory, LeaderboardCategoryDef> = Object.fromEntries(
  LEADERBOARD_CATEGORIES.map((c) => [c.id, c]),
) as Record<LeaderboardCategory, LeaderboardCategoryDef>;

export const WEEKLY_CATEGORIES: LeaderboardCategory[] = LEADERBOARD_CATEGORIES.filter((c) => c.weekly).map((c) => c.id);

export function isLeaderboardCategory(x: string): x is LeaderboardCategory {
  return x in LEADERBOARD_BY_ID;
}

const int = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/**
 * Formats a raw board value. `secondary` = xp for 'level', total species for 'collection'.
 */
export function formatLeaderboardValue(category: LeaderboardCategory, value: number, secondary?: number): string {
  switch (category) {
    case 'heaviest_week':
      return `${dec.format(value)} кг`;
    case 'coins_week':
      return `🪙 ${int.format(value)}`;
    case 'rare_week':
      return `${int.format(value)} шт.`;
    case 'collection': {
      if (!secondary) return `${int.format(value)} видов`;
      return `${int.format(value)}/${int.format(secondary)} (${int.format(Math.floor((value / secondary) * 100))}%)`;
    }
    case 'pass_level':
      return `ур. ${int.format(value)}`;
    case 'boss_damage_season':
      return `${int.format(value)} урона`;
    case 'level':
      return secondary !== undefined ? `ур. ${int.format(value)} · ${int.format(secondary)} XP` : `ур. ${int.format(value)}`;
    case 'casino_week':
      return `${value > 0 ? '+' : ''}🪙 ${int.format(value)}`;
  }
}

/** "Твоё место: #3 — 12,5 кг" / "Тебя пока нет в этом рейтинге". */
export function formatRankLine(me: { rank: number; value: string } | null): string {
  return me ? `Твоё место: **#${me.rank}** — ${me.value}` : 'Тебя пока нет в этом рейтинге.';
}

/** Medal for top-3 places, else "#n". */
export function placeLabel(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
}
