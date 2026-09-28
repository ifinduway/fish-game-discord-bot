// STUB (WP0) — WP1 replaces the contents but must keep export names/types.
import { BALANCE } from '../config/balance.js';
const PX = BALANCE.passXp;
export const CHALLENGE_TEMPLATES = [
    { id: 'd_catch', scope: 'daily', metric: 'catch', target: [8, 12], title: 'Поймать {n} рыб', reward: { pearls: 2, coins: 50 }, passXp: PX.dailyChallenge },
    { id: 'd_perfect', scope: 'daily', metric: 'perfect', target: [3, 3], title: 'Сделать {n} идеальные подсечки', reward: { pearls: 3 }, passXp: PX.dailyChallenge },
    { id: 'd_blackjack', scope: 'daily', metric: 'blackjack_hands', target: [3, 3], title: 'Сыграть {n} раздачи в блэкджек', reward: { coins: 150 }, passXp: PX.dailyChallenge },
    { id: 'w_catch', scope: 'weekly', metric: 'catch', target: [90, 110], title: 'Поймать {n} рыб', reward: { pearls: 10 }, passXp: PX.weeklyChallenge },
    { id: 's_seasonal', scope: 'seasonal', metric: 'catch_seasonal', target: [4, 4], title: 'Поймать {n} сезонные рыбы', reward: { pearls: 20, coins: 1000 }, passXp: PX.seasonalChallenge },
];
export const CHALLENGE_BY_ID = Object.fromEntries(CHALLENGE_TEMPLATES.map((c) => [c.id, c]));
//# sourceMappingURL=challenges.js.map