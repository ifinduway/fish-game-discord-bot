// WP1: cosmetics catalog — titles, frames, backgrounds, badges. Keep export names/types stable.
//
// Season-top titles are NOT stored here: WP3 grants them dynamically at season end as
// `season-<n>-top` (plan §6 WP3 / spec §8). Use `getCosmetic(id)` below instead of a raw
// `COSMETIC_BY_ID[id]` lookup whenever the id might be one of those synthesized titles.
import type { CosmeticDef } from './types.js';

export const COSMETICS: CosmeticDef[] = [
  // Titles
  { id: 'title-novice', type: 'title', name: 'Новичок', rarity: 'common' },
  { id: 'title-angler', type: 'title', name: 'Заядлый рыбак', rarity: 'rare' },
  { id: 'title-collector', type: 'title', name: 'Коллекционер', rarity: 'rare' },
  { id: 'title-lucky', type: 'title', name: 'Счастливчик', rarity: 'uncommon' },
  { id: 'title-night-owl', type: 'title', name: 'Ночной охотник', rarity: 'epic' },
  { id: 'title-champion', type: 'title', name: 'Чемпион турнира', rarity: 'epic' },
  { id: 'title-legend', type: 'title', name: 'Легенда рыбалки', rarity: 'legendary' },
  { id: 'title-boss-slayer', type: 'title', name: 'Победитель босса', rarity: 'legendary' },
  { id: 'title-season-master', type: 'title', name: 'Мастер сезона', rarity: 'legendary' },
  { id: 'title-abyss-walker', type: 'title', name: 'Покоритель бездны', rarity: 'mythic' },

  // Frames
  { id: 'frame-wood', type: 'frame', name: 'Деревянная рамка', rarity: 'common', color: '#8d6e63' },
  { id: 'frame-silver', type: 'frame', name: 'Серебряная рамка', rarity: 'rare', color: '#c0c0c0' },
  { id: 'frame-gold', type: 'frame', name: 'Золотая рамка', rarity: 'epic', color: '#ffd700' },
  { id: 'frame-emerald', type: 'frame', name: 'Изумрудная рамка', rarity: 'epic', color: '#2ecc71' },
  { id: 'frame-royal', type: 'frame', name: 'Королевская рамка', rarity: 'legendary', gradient: ['#7b1fa2', '#ffd700'] },
  { id: 'frame-cosmic', type: 'frame', name: 'Космическая рамка', rarity: 'mythic', gradient: ['#0f0c29', '#302b63'] },

  // Backgrounds
  { id: 'bg-pond', type: 'background', name: 'Пруд на закате', rarity: 'common', gradient: ['#2e7d32', '#a5d6a7'] },
  { id: 'bg-river', type: 'background', name: 'Быстрая река', rarity: 'uncommon', gradient: ['#0288d1', '#b3e5fc'] },
  { id: 'bg-ocean', type: 'background', name: 'Океан', rarity: 'epic', gradient: ['#0f2027', '#2c5364'] },
  { id: 'bg-sunset', type: 'background', name: 'Рыбацкий закат', rarity: 'rare', gradient: ['#ff512f', '#f09819'] },
  { id: 'bg-night', type: 'background', name: 'Ночная рыбалка', rarity: 'epic', gradient: ['#000428', '#004e92'] },
  { id: 'bg-aurora', type: 'background', name: 'Северное сияние', rarity: 'legendary', gradient: ['#1e3c72', '#9be7ff'] },
  { id: 'bg-abyss', type: 'background', name: 'Бездна', rarity: 'mythic', gradient: ['#000000', '#360033'] },

  // Badges (season themes + boss/collector accents)
  { id: 'badge-season-winter', type: 'badge', name: 'Значок «Зима»', rarity: 'epic', color: '#9be7ff' },
  { id: 'badge-season-spring', type: 'badge', name: 'Значок «Весна»', rarity: 'epic', color: '#f8bbd0' },
  { id: 'badge-season-summer', type: 'badge', name: 'Значок «Лето»', rarity: 'epic', color: '#ffb300' },
  { id: 'badge-season-autumn', type: 'badge', name: 'Значок «Осень»', rarity: 'epic', color: '#ff7043' },
  { id: 'badge-boss-slayer', type: 'badge', name: 'Значок «Победитель босса»', rarity: 'legendary', color: '#e53935' },
  { id: 'badge-collector', type: 'badge', name: 'Значок «Коллекционер»', rarity: 'rare', color: '#8e24aa' },
];

export const COSMETIC_BY_ID: Record<string, CosmeticDef> = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));

/**
 * Looks up a cosmetic by id, synthesizing the dynamic season-end titles WP3 grants
 * (`season-<n>-top`, e.g. "season-3-top") that never appear in COSMETIC_BY_ID.
 * Prefer this helper over a raw `COSMETIC_BY_ID[id]` wherever such an id may occur.
 */
export function getCosmetic(id: string): CosmeticDef | undefined {
  const known = COSMETIC_BY_ID[id];
  if (known) return known;
  const match = /^season-(\d+)-top$/.exec(id);
  if (match) {
    return { id, type: 'title', name: `Топ сезона ${match[1]}`, rarity: 'legendary' };
  }
  return undefined;
}
