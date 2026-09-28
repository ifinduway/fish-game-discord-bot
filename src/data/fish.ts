// WP1: regular + seasonal fish species and junk items. Keep export names/types stable.
import type { FishSpecies, JunkItem } from './types.js';

// ~10 species per location, all 6 rarities represented per location (3 common, 2 uncommon,
// 2 rare, 1 epic, 1 legendary, 1 mythic).
export const FISH: FishSpecies[] = [
  // ── Пруд (уровень 1) ──────────────────────────────────────────────
  { id: 'crucian', name: 'Карась', emoji: '🐟', rarity: 'common', locations: ['pond'], minWeight: 0.1, maxWeight: 1.2, basePrice: 8, description: 'Неприхотливый житель прудов, ловится в любую погоду.' },
  { id: 'rotan', name: 'Ротан', emoji: '🐟', rarity: 'common', locations: ['pond'], minWeight: 0.05, maxWeight: 0.4, basePrice: 6, description: 'Прожорливый и вездесущий.' },
  { id: 'gudgeon', name: 'Пескарь', emoji: '🐟', rarity: 'common', locations: ['pond'], minWeight: 0.05, maxWeight: 0.3, basePrice: 7, description: 'Мелкая рыбка со дна.' },
  { id: 'roach', name: 'Плотва', emoji: '🐟', rarity: 'uncommon', locations: ['pond'], minWeight: 0.1, maxWeight: 0.8, basePrice: 15, description: 'Серебристая и шустрая.' },
  { id: 'tench', name: 'Линь', emoji: '🐠', rarity: 'uncommon', locations: ['pond'], times: ['morning', 'evening'], minWeight: 0.3, maxWeight: 2, basePrice: 20, description: 'Любит тину и тишину.' },
  { id: 'pond-carp', name: 'Карп', emoji: '🐟', rarity: 'rare', locations: ['pond'], times: ['night'], minWeight: 1, maxWeight: 6, basePrice: 45, description: 'Осторожная рыба, лучше клюёт ночью.' },
  { id: 'young-wels', name: 'Сом-подросток', emoji: '🐊', rarity: 'rare', locations: ['pond'], times: ['night'], minWeight: 2, maxWeight: 10, basePrice: 55, description: 'Ещё маленький, но уже зубастый.' },
  { id: 'golden-carp', name: 'Золотой карп', emoji: '🐡', rarity: 'epic', locations: ['pond'], minWeight: 2, maxWeight: 8, basePrice: 150, description: 'Говорят, исполняет желания.' },
  { id: 'pond-king', name: 'Царь пруда', emoji: '👑', rarity: 'legendary', locations: ['pond'], times: ['night'], minWeight: 8, maxWeight: 20, basePrice: 450, description: 'Старейший обитатель пруда.' },
  { id: 'moon-koi', name: 'Лунный кои', emoji: '🌙', rarity: 'mythic', locations: ['pond'], times: ['night'], minWeight: 5, maxWeight: 12, basePrice: 1300, description: 'Светится в лунном свете.' },

  // ── Река (уровень 5) ──────────────────────────────────────────────
  { id: 'perch', name: 'Окунь', emoji: '🐟', rarity: 'common', locations: ['river'], minWeight: 0.1, maxWeight: 1.5, basePrice: 12, description: 'Полосатый разбойник.' },
  { id: 'bleak', name: 'Уклейка', emoji: '🐟', rarity: 'common', locations: ['river'], minWeight: 0.05, maxWeight: 0.3, basePrice: 8, description: 'Стайная мелочь у поверхности.' },
  { id: 'ruffe', name: 'Ёрш', emoji: '🐟', rarity: 'common', locations: ['river'], minWeight: 0.1, maxWeight: 0.4, basePrice: 9, description: 'Колючий, но безобидный.' },
  { id: 'chub', name: 'Голавль', emoji: '🐟', rarity: 'uncommon', locations: ['river'], minWeight: 0.3, maxWeight: 3, basePrice: 22, description: 'Сильная и осторожная рыба быстрин.' },
  { id: 'ide', name: 'Язь', emoji: '🐟', rarity: 'uncommon', locations: ['river'], minWeight: 0.5, maxWeight: 4, basePrice: 25, description: 'Держится в заводях.' },
  { id: 'zander', name: 'Судак', emoji: '🐟', rarity: 'rare', locations: ['river'], times: ['morning', 'evening'], minWeight: 1, maxWeight: 8, basePrice: 60, description: 'Хищник с острыми клыками.' },
  { id: 'brook-trout', name: 'Ручьевая форель', emoji: '🐠', rarity: 'rare', locations: ['river'], times: ['morning'], minWeight: 0.3, maxWeight: 3, basePrice: 55, description: 'Ловится в чистой быстрой воде.' },
  { id: 'taimen', name: 'Таймень', emoji: '🐟', rarity: 'epic', locations: ['river'], minWeight: 5, maxWeight: 25, basePrice: 180, description: 'Крупный лосось сибирских рек.' },
  { id: 'giant-wels', name: 'Сом-великан', emoji: '🐊', rarity: 'legendary', locations: ['river'], times: ['night'], minWeight: 20, maxWeight: 80, basePrice: 500, description: 'Ходят легенды о его размерах.' },
  { id: 'river-dragon', name: 'Речной дракон', emoji: '🐉', rarity: 'mythic', locations: ['river'], times: ['night'], minWeight: 10, maxWeight: 30, basePrice: 1400, description: 'Существо из рыбацких баек.' },

  // ── Озеро (уровень 10) ────────────────────────────────────────────
  { id: 'pike', name: 'Щука', emoji: '🐊', rarity: 'common', locations: ['lake'], minWeight: 1, maxWeight: 10, basePrice: 25, description: 'Зубастая хищница озёр.' },
  { id: 'bream', name: 'Лещ', emoji: '🐟', rarity: 'common', locations: ['lake'], minWeight: 0.5, maxWeight: 4, basePrice: 20, description: 'Широкий и плоский, ходит стаями.' },
  { id: 'lake-carp', name: 'Озёрный карп', emoji: '🐟', rarity: 'common', locations: ['lake'], minWeight: 1, maxWeight: 6, basePrice: 24, description: 'Обычный обитатель тихих заводей.' },
  { id: 'lake-zander', name: 'Озёрный судак', emoji: '🐟', rarity: 'uncommon', locations: ['lake'], times: ['morning', 'evening'], minWeight: 1, maxWeight: 9, basePrice: 40, description: 'Охотится на глубине.' },
  { id: 'wild-carp', name: 'Сазан', emoji: '🐟', rarity: 'uncommon', locations: ['lake'], minWeight: 2, maxWeight: 12, basePrice: 45, description: 'Дикий предок карпа, силён на леске.' },
  { id: 'wels-catfish', name: 'Сом', emoji: '🐊', rarity: 'rare', locations: ['lake'], times: ['night'], minWeight: 10, maxWeight: 60, basePrice: 90, description: 'Хозяин озёрных глубин.' },
  { id: 'eel', name: 'Угорь', emoji: '🐍', rarity: 'rare', locations: ['lake'], times: ['night'], minWeight: 0.5, maxWeight: 5, basePrice: 85, description: 'Скользкий и загадочный.' },
  { id: 'sturgeon', name: 'Осётр', emoji: '🐟', rarity: 'epic', locations: ['lake'], minWeight: 10, maxWeight: 50, basePrice: 220, description: 'Ценная и редкая рыба.' },
  { id: 'lake-monster', name: 'Озёрное чудовище', emoji: '🐲', rarity: 'legendary', locations: ['lake'], times: ['night'], minWeight: 40, maxWeight: 120, basePrice: 600, description: 'О нём слагают легенды у костра.' },
  { id: 'ghost-eel', name: 'Призрачный угорь', emoji: '👻', rarity: 'mythic', locations: ['lake'], times: ['night'], minWeight: 5, maxWeight: 20, basePrice: 1600, description: 'Полупрозрачный и почти невесомый.' },

  // ── Море (уровень 20) ─────────────────────────────────────────────
  { id: 'herring', name: 'Сельдь', emoji: '🐟', rarity: 'common', locations: ['sea'], minWeight: 0.2, maxWeight: 1, basePrice: 25, description: 'Идёт косяками.' },
  { id: 'mackerel', name: 'Скумбрия', emoji: '🐟', rarity: 'common', locations: ['sea'], minWeight: 0.3, maxWeight: 1.5, basePrice: 28, description: 'Полосатая и быстрая.' },
  { id: 'horse-mackerel', name: 'Ставрида', emoji: '🐟', rarity: 'common', locations: ['sea'], minWeight: 0.2, maxWeight: 1, basePrice: 22, description: 'Держится у поверхности.' },
  { id: 'cod', name: 'Треска', emoji: '🐟', rarity: 'uncommon', locations: ['sea'], minWeight: 1, maxWeight: 8, basePrice: 50, description: 'Холодноводный промысловый вид.' },
  { id: 'flounder', name: 'Камбала', emoji: '🐟', rarity: 'uncommon', locations: ['sea'], minWeight: 0.5, maxWeight: 3, basePrice: 45, description: 'Плоская, маскируется на дне.' },
  { id: 'tuna', name: 'Тунец', emoji: '🐟', rarity: 'rare', locations: ['sea'], minWeight: 20, maxWeight: 150, basePrice: 150, description: 'Быстрый пелагический хищник.' },
  { id: 'dogfish-shark', name: 'Акула-катран', emoji: '🦈', rarity: 'rare', locations: ['sea'], times: ['night'], minWeight: 5, maxWeight: 30, basePrice: 140, description: 'Небольшая, но зубастая акула.' },
  { id: 'marlin', name: 'Марлин', emoji: '🐟', rarity: 'epic', locations: ['sea'], minWeight: 50, maxWeight: 250, basePrice: 350, description: 'Трофей мечты рыбака.' },
  { id: 'swordfish', name: 'Меч-рыба', emoji: '⚔️', rarity: 'legendary', locations: ['sea'], minWeight: 80, maxWeight: 300, basePrice: 800, description: 'Стремительная и опасная.' },
  { id: 'tsar-fish', name: 'Царь-рыба', emoji: '👑', rarity: 'mythic', locations: ['sea'], times: ['night'], minWeight: 100, maxWeight: 400, basePrice: 2000, description: 'Легендарная рыба из старинных сказаний.' },

  // ── Глубоководье (уровень 35) ─────────────────────────────────────
  { id: 'anglerfish', name: 'Удильщик', emoji: '🏮', rarity: 'common', locations: ['deep'], times: ['night'], minWeight: 2, maxWeight: 15, basePrice: 70, description: 'Сам себе фонарик.' },
  { id: 'grenadier', name: 'Гренадёр', emoji: '🐟', rarity: 'common', locations: ['deep'], minWeight: 1, maxWeight: 10, basePrice: 65, description: 'Длиннохвостая глубоководная рыба.' },
  { id: 'deep-scorpionfish', name: 'Глубинный морской ёрш', emoji: '🐟', rarity: 'common', locations: ['deep'], minWeight: 1, maxWeight: 8, basePrice: 60, description: 'Колючий обитатель мрака.' },
  { id: 'monkfish', name: 'Морской чёрт', emoji: '🐟', rarity: 'uncommon', locations: ['deep'], minWeight: 3, maxWeight: 20, basePrice: 100, description: 'Пугающий облик, вкусное мясо.' },
  { id: 'giant-spider-crab', name: 'Гигантский краб-паук', emoji: '🦀', rarity: 'uncommon', locations: ['deep'], minWeight: 2, maxWeight: 15, basePrice: 95, description: 'Размах клешней впечатляет.' },
  { id: 'vampire-squid', name: 'Кальмар-вампир', emoji: '🦑', rarity: 'rare', locations: ['deep'], times: ['night'], minWeight: 5, maxWeight: 25, basePrice: 180, description: 'Мрачный житель бездны.' },
  { id: 'giant-hatchetfish', name: 'Большая рыба-топор', emoji: '🐟', rarity: 'rare', locations: ['deep'], times: ['night'], minWeight: 3, maxWeight: 18, basePrice: 170, description: 'Блестящая чешуя в темноте.' },
  { id: 'giant-squid', name: 'Гигантский кальмар', emoji: '🦑', rarity: 'epic', locations: ['deep'], minWeight: 50, maxWeight: 300, basePrice: 450, description: 'Морской монстр из легенд моряков.' },
  { id: 'baby-kraken', name: 'Кракенёнок', emoji: '🐙', rarity: 'legendary', locations: ['deep'], times: ['night'], minWeight: 100, maxWeight: 500, basePrice: 1000, description: 'Ещё юн, но уже наводит ужас.' },
  { id: 'abyss-leviathan', name: 'Левиафан бездны', emoji: '🐋', rarity: 'mythic', locations: ['deep'], times: ['night'], minWeight: 200, maxWeight: 800, basePrice: 2500, description: 'Древнее чудище, о котором молчат карты.' },

  // ── Сезонные виды (4 на тему, 16 всего) ───────────────────────────
  { id: 'snow-char', name: 'Снежный голец', emoji: '❄️', rarity: 'rare', locations: ['lake'], seasonTheme: 'winter', minWeight: 1, maxWeight: 5, basePrice: 90, description: 'Появляется только зимой.' },
  { id: 'ice-perch', name: 'Ледяной окунь', emoji: '❄️', rarity: 'uncommon', locations: ['river'], seasonTheme: 'winter', minWeight: 0.2, maxWeight: 2, basePrice: 35, description: 'Ловится подо льдом.' },
  { id: 'frost-pike', name: 'Морозная щука', emoji: '❄️', rarity: 'epic', locations: ['lake'], seasonTheme: 'winter', minWeight: 3, maxWeight: 15, basePrice: 200, description: 'Крупная хищница ледяных вод.' },
  { id: 'winter-king-salmon', name: 'Зимний король-лосось', emoji: '❄️', rarity: 'legendary', locations: ['sea'], seasonTheme: 'winter', minWeight: 10, maxWeight: 40, basePrice: 550, description: 'Заходит в холодные воды раз в году.' },

  { id: 'spring-roach', name: 'Весенняя плотва', emoji: '🌸', rarity: 'common', locations: ['pond'], seasonTheme: 'spring', minWeight: 0.1, maxWeight: 1, basePrice: 15, description: 'Активизируется с первым теплом.' },
  { id: 'blossom-carp', name: 'Карп в цвету', emoji: '🌸', rarity: 'uncommon', locations: ['pond'], seasonTheme: 'spring', minWeight: 1, maxWeight: 5, basePrice: 40, description: 'Нерестится среди цветущих кувшинок.' },
  { id: 'spawning-salmon', name: 'Нерестовый лосось', emoji: '🌸', rarity: 'rare', locations: ['river'], seasonTheme: 'spring', minWeight: 3, maxWeight: 12, basePrice: 120, description: 'Поднимается вверх по течению.' },
  { id: 'spring-rainbow-trout', name: 'Радужная форель', emoji: '🌸', rarity: 'epic', locations: ['lake'], seasonTheme: 'spring', minWeight: 1, maxWeight: 6, basePrice: 210, description: 'Переливается всеми цветами весны.' },

  { id: 'sun-herring', name: 'Солнечная сельдь', emoji: '☀️', rarity: 'common', locations: ['sea'], seasonTheme: 'summer', minWeight: 0.2, maxWeight: 1, basePrice: 22, description: 'Клюёт на жарком солнце.' },
  { id: 'golden-tench', name: 'Золотистый линь', emoji: '☀️', rarity: 'uncommon', locations: ['pond'], seasonTheme: 'summer', minWeight: 0.5, maxWeight: 3, basePrice: 42, description: 'Отливает золотом летом.' },
  { id: 'heatwave-marlin', name: 'Марлин зноя', emoji: '☀️', rarity: 'rare', locations: ['sea'], seasonTheme: 'summer', minWeight: 30, maxWeight: 120, basePrice: 260, description: 'Появляется в самую жару.' },
  { id: 'summer-dorado', name: 'Летний дорадо', emoji: '☀️', rarity: 'epic', locations: ['sea'], seasonTheme: 'summer', minWeight: 5, maxWeight: 25, basePrice: 240, description: 'Яркая рыба тёплых течений.' },

  { id: 'autumn-perch', name: 'Осенний окунь', emoji: '🍂', rarity: 'common', locations: ['river'], seasonTheme: 'autumn', minWeight: 0.2, maxWeight: 1.5, basePrice: 18, description: 'Активно кормится перед зимой.' },
  { id: 'amber-carp', name: 'Янтарный карп', emoji: '🍂', rarity: 'uncommon', locations: ['lake'], seasonTheme: 'autumn', minWeight: 2, maxWeight: 8, basePrice: 45, description: 'Цвета осенней листвы.' },
  { id: 'migrating-eel', name: 'Мигрирующий угорь', emoji: '🍂', rarity: 'rare', locations: ['river'], seasonTheme: 'autumn', minWeight: 1, maxWeight: 6, basePrice: 130, description: 'Отправляется в дальний путь осенью.' },
  { id: 'harvest-sturgeon', name: 'Урожайный осётр', emoji: '🍂', rarity: 'legendary', locations: ['sea'], seasonTheme: 'autumn', minWeight: 15, maxWeight: 60, basePrice: 620, description: 'Самый крупный улов сезона сбора урожая.' },
];

export const FISH_BY_ID: Record<string, FishSpecies> = Object.fromEntries(FISH.map((f) => [f.id, f]));

export const JUNK_ITEMS: JunkItem[] = [
  { id: 'boot', name: 'Старый ботинок', emoji: '🥾', coins: 1 },
  { id: 'seaweed', name: 'Водоросли', emoji: '🌿', coins: 0 },
  { id: 'tin-can', name: 'Консервная банка', emoji: '🥫', coins: 2 },
  { id: 'broken-bottle', name: 'Разбитая бутылка', emoji: '🍾', coins: 1 },
  { id: 'old-tire', name: 'Старая шина', emoji: '🛞', coins: 3 },
  { id: 'plastic-bag', name: 'Полиэтиленовый пакет', emoji: '🛍️', coins: 0 },
  { id: 'rusty-hook', name: 'Ржавый крючок', emoji: '🪝', coins: 2 },
  { id: 'tangled-line', name: 'Клубок лески', emoji: '🧶', coins: 1 },
  { id: 'driftwood', name: 'Коряга', emoji: '🪵', coins: 0 },
  { id: 'lost-wallet', name: 'Потерянный кошелёк', emoji: '👛', coins: 15 },
];
