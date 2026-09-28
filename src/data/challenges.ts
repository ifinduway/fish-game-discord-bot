// WP1: challenge template pool. ≥15 daily / ≥10 weekly / ≥12 seasonal per plan §8.1 test.
// Daily pearls stay within BALANCE.challenges.dailyPearlsMin..Max (2-3) EXCEPT the blackjack
// challenge, which intentionally gives coins only (spec §12 "Связь с испытаниями").
import { BALANCE } from '../config/balance.js';
import type { ChallengeTemplate } from './types.js';

const PX = BALANCE.passXp;

export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  // ── Ежедневные (16) ───────────────────────────────────────────────
  { id: 'd-catch', scope: 'daily', metric: 'catch', target: [8, 12], title: 'Поймать {n} рыб', reward: { pearls: 2, coins: 50 }, passXp: PX.dailyChallenge },
  { id: 'd-catch-more', scope: 'daily', metric: 'catch', target: [15, 20], title: 'Поймать {n} рыб', reward: { pearls: 3, coins: 80 }, passXp: PX.dailyChallenge },
  { id: 'd-perfect', scope: 'daily', metric: 'perfect', target: [3, 4], title: 'Сделать {n} идеальные подсечки', reward: { pearls: 3 }, passXp: PX.dailyChallenge },
  { id: 'd-blackjack', scope: 'daily', metric: 'blackjack_hands', target: [3, 3], title: 'Сыграть {n} раздачи в блэкджек', reward: { coins: 150 }, passXp: PX.dailyChallenge },
  { id: 'd-rare-plus', scope: 'daily', metric: 'catch_rare_plus', target: [1, 2], title: 'Поймать {n} Редкую+ рыбу', reward: { pearls: 3 }, passXp: PX.dailyChallenge },
  { id: 'd-epic-plus', scope: 'daily', metric: 'catch_epic_plus', target: [1, 1], title: 'Поймать {n} Эпическую+ рыбу', reward: { pearls: 3, coins: 100 }, passXp: PX.dailyChallenge },
  { id: 'd-sell', scope: 'daily', metric: 'sell_coins', target: [300, 500], title: 'Продать рыбы на {n} 🪙', reward: { pearls: 2, coins: 30 }, passXp: PX.dailyChallenge },
  { id: 'd-cast-pond', scope: 'daily', metric: 'cast_at_location', param: 'pond', target: [10, 15], title: 'Сделать {n} забросов в Пруду', reward: { pearls: 2 }, passXp: PX.dailyChallenge },
  { id: 'd-cast-river', scope: 'daily', metric: 'cast_at_location', param: 'river', target: [10, 15], title: 'Сделать {n} забросов на Реке', reward: { pearls: 2 }, passXp: PX.dailyChallenge },
  { id: 'd-cast-lake', scope: 'daily', metric: 'cast_at_location', param: 'lake', target: [8, 12], title: 'Сделать {n} забросов на Озере', reward: { pearls: 2 }, passXp: PX.dailyChallenge },
  { id: 'd-heavy', scope: 'daily', metric: 'catch_heavier_than', param: '3', target: [1, 1], title: 'Поймать рыбу тяжелее {param} кг', reward: { pearls: 3 }, passXp: PX.dailyChallenge },
  { id: 'd-chest', scope: 'daily', metric: 'open_chest', target: [1, 1], title: 'Открыть {n} сундук', reward: { pearls: 2 }, passXp: PX.dailyChallenge },
  { id: 'd-new-species', scope: 'daily', metric: 'new_species', target: [1, 1], title: 'Поймать {n} новый вид рыбы', reward: { pearls: 3 }, passXp: PX.dailyChallenge },
  { id: 'd-weight', scope: 'daily', metric: 'total_weight', target: [10, 15], title: 'Наловить суммарно {n} кг рыбы', reward: { pearls: 2, coins: 40 }, passXp: PX.dailyChallenge },
  { id: 'd-spend', scope: 'daily', metric: 'spend_coins', target: [100, 200], title: 'Потратить {n} 🪙', reward: { pearls: 2 }, passXp: PX.dailyChallenge },
  { id: 'd-upgrade', scope: 'daily', metric: 'upgrade_gear', target: [1, 1], title: 'Улучшить снаряжение {n} раз', reward: { pearls: 3 }, passXp: PX.dailyChallenge },

  // ── Еженедельные (11) ─────────────────────────────────────────────
  { id: 'w-catch', scope: 'weekly', metric: 'catch', target: [90, 110], title: 'Поймать {n} рыб', reward: { pearls: 12 }, passXp: PX.weeklyChallenge },
  { id: 'w-epic', scope: 'weekly', metric: 'catch_epic_plus', target: [3, 4], title: 'Поймать {n} Эпические+ рыбы', reward: { pearls: 15 }, passXp: PX.weeklyChallenge },
  { id: 'w-chests', scope: 'weekly', metric: 'open_chest', target: [5, 7], title: 'Открыть {n} сундуков', reward: { pearls: 10 }, passXp: PX.weeklyChallenge },
  { id: 'w-boss', scope: 'weekly', metric: 'boss_damage', target: [500, 800], title: 'Нанести {n} урона боссу', reward: { pearls: 15 }, passXp: PX.weeklyChallenge },
  { id: 'w-new-species', scope: 'weekly', metric: 'new_species', target: [2, 3], title: 'Найти {n} новых видов', reward: { pearls: 12 }, passXp: PX.weeklyChallenge },
  { id: 'w-sell', scope: 'weekly', metric: 'sell_coins', target: [3000, 5000], title: 'Продать рыбы на {n} 🪙', reward: { pearls: 10, coins: 500 }, passXp: PX.weeklyChallenge },
  { id: 'w-perfect', scope: 'weekly', metric: 'perfect', target: [15, 20], title: 'Сделать {n} идеальных подсечки', reward: { pearls: 12 }, passXp: PX.weeklyChallenge },
  { id: 'w-weight', scope: 'weekly', metric: 'total_weight', target: [300, 500], title: 'Наловить суммарно {n} кг рыбы', reward: { pearls: 13 }, passXp: PX.weeklyChallenge },
  { id: 'w-blackjack', scope: 'weekly', metric: 'blackjack_hands', target: [10, 15], title: 'Сыграть {n} раздач в блэкджек', reward: { pearls: 10, coins: 300 }, passXp: PX.weeklyChallenge },
  { id: 'w-upgrade', scope: 'weekly', metric: 'upgrade_gear', target: [3, 5], title: 'Улучшить снаряжение {n} раз', reward: { pearls: 14 }, passXp: PX.weeklyChallenge },
  { id: 'w-heavy', scope: 'weekly', metric: 'catch_heavier_than', param: '20', target: [3, 3], title: 'Поймать {n} рыбы тяжелее {param} кг', reward: { pearls: 15 }, passXp: PX.weeklyChallenge },

  // ── Сезонные (13) ─────────────────────────────────────────────────
  { id: 's-seasonal-catch', scope: 'seasonal', metric: 'catch_seasonal', target: [4, 4], title: 'Поймать {n} сезонные рыбы', reward: { pearls: 20, coins: 1000 }, passXp: PX.seasonalChallenge },
  { id: 's-seasonal-catch-more', scope: 'seasonal', metric: 'catch_seasonal', target: [10, 10], title: 'Поймать {n} сезонных рыб', reward: { pearls: 35, coins: 2000 }, passXp: PX.seasonalChallenge },
  { id: 's-catch', scope: 'seasonal', metric: 'catch', target: [500, 700], title: 'Поймать {n} рыб за сезон', reward: { pearls: 25 }, passXp: PX.seasonalChallenge },
  { id: 's-epic', scope: 'seasonal', metric: 'catch_epic_plus', target: [15, 20], title: 'Поймать {n} Эпических+ рыб', reward: { pearls: 30 }, passXp: PX.seasonalChallenge },
  { id: 's-heavy', scope: 'seasonal', metric: 'catch_heavier_than', param: '50', target: [5, 5], title: 'Поймать {n} рыб тяжелее {param} кг', reward: { pearls: 25 }, passXp: PX.seasonalChallenge },
  { id: 's-boss', scope: 'seasonal', metric: 'boss_damage', target: [3000, 5000], title: 'Нанести {n} урона боссам за сезон', reward: { pearls: 30 }, passXp: PX.seasonalChallenge },
  { id: 's-chests', scope: 'seasonal', metric: 'open_chest', target: [20, 25], title: 'Открыть {n} сундуков за сезон', reward: { pearls: 25, coins: 1500 }, passXp: PX.seasonalChallenge },
  { id: 's-weight', scope: 'seasonal', metric: 'total_weight', target: [2000, 3000], title: 'Наловить суммарно {n} кг рыбы', reward: { pearls: 30 }, passXp: PX.seasonalChallenge },
  { id: 's-new-species', scope: 'seasonal', metric: 'new_species', target: [10, 15], title: 'Найти {n} новых видов рыб', reward: { pearls: 35 }, passXp: PX.seasonalChallenge },
  { id: 's-sell', scope: 'seasonal', metric: 'sell_coins', target: [20000, 30000], title: 'Продать рыбы на {n} 🪙', reward: { pearls: 25, coins: 2000 }, passXp: PX.seasonalChallenge },
  { id: 's-blackjack', scope: 'seasonal', metric: 'blackjack_hands', target: [100, 150], title: 'Сыграть {n} раздач в блэкджек', reward: { pearls: 20, coins: 3000 }, passXp: PX.seasonalChallenge },
  { id: 's-upgrade', scope: 'seasonal', metric: 'upgrade_gear', target: [10, 15], title: 'Улучшить снаряжение {n} раз', reward: { pearls: 25 }, passXp: PX.seasonalChallenge },
  { id: 's-perfect', scope: 'seasonal', metric: 'perfect', target: [100, 150], title: 'Сделать {n} идеальных подсечки', reward: { pearls: 25 }, passXp: PX.seasonalChallenge },
];

export const CHALLENGE_BY_ID: Record<string, ChallengeTemplate> = Object.fromEntries(CHALLENGE_TEMPLATES.map((c) => [c.id, c]));
