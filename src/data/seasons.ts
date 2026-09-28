// STUB (WP0) — WP1 may refine but must keep export names/types.
import type { SeasonTheme, SeasonThemeId } from './types.js';

export const SEASON_THEMES: SeasonTheme[] = [
  { id: 'winter', name: 'Ледяная рыбалка', emoji: '❄️', colors: ['#1e3c72', '#9be7ff'] },
  { id: 'spring', name: 'Весенний клёв', emoji: '🌸', colors: ['#2e7d32', '#f8bbd0'] },
  { id: 'summer', name: 'Жаркое лето', emoji: '☀️', colors: ['#f57f17', '#4fc3f7'] },
  { id: 'autumn', name: 'Золотая осень', emoji: '🍂', colors: ['#6d4c41', '#ffb74d'] },
];

export const SEASON_THEME_BY_ID: Record<SeasonThemeId, SeasonTheme> = Object.fromEntries(SEASON_THEMES.map((t) => [t.id, t])) as Record<
  SeasonThemeId,
  SeasonTheme
>;
