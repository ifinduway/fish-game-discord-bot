// WP1: gear catalog — 4 slots × 6 tiers = 24 items with coherent stat progression.
// Id convention: `<slot>-<tier>`. common/uncommon/rare are shop-purchasable; epic+ are
// chest/pass/boss exclusives (no shopPrice) per plan §6 (gear).
import type { GearDef } from './types.js';

export const GEAR: GearDef[] = [
  // 🎣 Удочка — rarityBonus (шанс редкой рыбы) + biteWindowMs (окно подсечки)
  { id: 'rod-common', slot: 'rod', tier: 'common', name: 'Бамбуковая удочка', emoji: '🎣', stats: { rarityBonus: 0.02, biteWindowMs: 100 }, shopPrice: 150, unlockLevel: 1 },
  { id: 'rod-uncommon', slot: 'rod', tier: 'uncommon', name: 'Карбоновая удочка', emoji: '🎣', stats: { rarityBonus: 0.05, biteWindowMs: 200 }, shopPrice: 600, unlockLevel: 5 },
  { id: 'rod-rare', slot: 'rod', tier: 'rare', name: 'Спиннинг «Штурм»', emoji: '🎣', stats: { rarityBonus: 0.09, biteWindowMs: 350 }, shopPrice: 1500, unlockLevel: 10 },
  { id: 'rod-epic', slot: 'rod', tier: 'epic', name: 'Удочка мастера', emoji: '🎣', stats: { rarityBonus: 0.14, biteWindowMs: 500 }, unlockLevel: 20 },
  { id: 'rod-legendary', slot: 'rod', tier: 'legendary', name: 'Удочка Посейдона', emoji: '🔱', stats: { rarityBonus: 0.2, biteWindowMs: 700 }, unlockLevel: 35 },
  { id: 'rod-mythic', slot: 'rod', tier: 'mythic', name: 'Удочка забытых глубин', emoji: '🌌', stats: { rarityBonus: 0.28, biteWindowMs: 900 }, unlockLevel: 60 },

  // ⚙️ Катушка — weightBonus (доп. вес) + reelTimeMs (время на раунд вываживания)
  { id: 'reel-common', slot: 'reel', tier: 'common', name: 'Простая катушка', emoji: '⚙️', stats: { weightBonus: 0.03, reelTimeMs: 200 }, shopPrice: 140, unlockLevel: 1 },
  { id: 'reel-uncommon', slot: 'reel', tier: 'uncommon', name: 'Катушка с фрикционом', emoji: '⚙️', stats: { weightBonus: 0.06, reelTimeMs: 400 }, shopPrice: 550, unlockLevel: 5 },
  { id: 'reel-rare', slot: 'reel', tier: 'rare', name: 'Скоростная катушка', emoji: '⚙️', stats: { weightBonus: 0.1, reelTimeMs: 600 }, shopPrice: 1300, unlockLevel: 10 },
  { id: 'reel-epic', slot: 'reel', tier: 'epic', name: 'Катушка чемпиона', emoji: '⚙️', stats: { weightBonus: 0.15, reelTimeMs: 800 }, unlockLevel: 20 },
  { id: 'reel-legendary', slot: 'reel', tier: 'legendary', name: 'Катушка Тритона', emoji: '🔱', stats: { weightBonus: 0.21, reelTimeMs: 1000 }, unlockLevel: 35 },
  { id: 'reel-mythic', slot: 'reel', tier: 'mythic', name: 'Катушка левиафана', emoji: '🌌', stats: { weightBonus: 0.28, reelTimeMs: 1200 }, unlockLevel: 60 },

  // 🧵 Леска — reelMistakes (доп. допустимые ошибки) + maxWeight (кг без обрыва)
  { id: 'line-common', slot: 'line', tier: 'common', name: 'Нейлоновая леска', emoji: '🧵', stats: { reelMistakes: 0, maxWeight: 15 }, shopPrice: 120, unlockLevel: 1 },
  { id: 'line-uncommon', slot: 'line', tier: 'uncommon', name: 'Плетёная леска', emoji: '🧵', stats: { reelMistakes: 0, maxWeight: 30 }, shopPrice: 480, unlockLevel: 5 },
  { id: 'line-rare', slot: 'line', tier: 'rare', name: 'Флюорокарбоновая леска', emoji: '🧵', stats: { reelMistakes: 1, maxWeight: 60 }, shopPrice: 1200, unlockLevel: 10 },
  { id: 'line-epic', slot: 'line', tier: 'epic', name: 'Кевларовая леска', emoji: '🧵', stats: { reelMistakes: 1, maxWeight: 150 }, unlockLevel: 20 },
  { id: 'line-legendary', slot: 'line', tier: 'legendary', name: 'Леска из паутины бездны', emoji: '🕸️', stats: { reelMistakes: 2, maxWeight: 400 }, unlockLevel: 35 },
  { id: 'line-mythic', slot: 'line', tier: 'mythic', name: 'Леска левиафана', emoji: '🌌', stats: { reelMistakes: 2, maxWeight: 900 }, unlockLevel: 60 },

  // 🧥 Экипировка — maxEnergy + castCostReduction (+ energyRegenBonus на высоких тирах)
  { id: 'outfit-common', slot: 'outfit', tier: 'common', name: 'Панама рыбака', emoji: '🧥', stats: { maxEnergy: 5, castCostReduction: 0 }, shopPrice: 150, unlockLevel: 1 },
  { id: 'outfit-uncommon', slot: 'outfit', tier: 'uncommon', name: 'Жилет рыбака', emoji: '🦺', stats: { maxEnergy: 10, castCostReduction: 0 }, shopPrice: 480, unlockLevel: 5 },
  { id: 'outfit-rare', slot: 'outfit', tier: 'rare', name: 'Непромокаемый костюм', emoji: '🧥', stats: { maxEnergy: 15, castCostReduction: 1 }, shopPrice: 1400, unlockLevel: 10 },
  { id: 'outfit-epic', slot: 'outfit', tier: 'epic', name: 'Костюм следопыта', emoji: '🧥', stats: { maxEnergy: 20, castCostReduction: 1, energyRegenBonus: 0.1 }, unlockLevel: 20 },
  { id: 'outfit-legendary', slot: 'outfit', tier: 'legendary', name: 'Мантия Посейдона', emoji: '🔱', stats: { maxEnergy: 30, castCostReduction: 2, energyRegenBonus: 0.2 }, unlockLevel: 35 },
  { id: 'outfit-mythic', slot: 'outfit', tier: 'mythic', name: 'Одеяние бездны', emoji: '🌌', stats: { maxEnergy: 40, castCostReduction: 2, energyRegenBonus: 0.35 }, unlockLevel: 60 },
];

export const GEAR_BY_ID: Record<string, GearDef> = Object.fromEntries(GEAR.map((g) => [g.id, g]));
