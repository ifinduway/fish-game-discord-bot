// WP1: consumables — energy drink + baits. Keep export names/types stable.
import { BALANCE } from '../config/balance.js';
import type { ConsumableDef } from './types.js';

export const CONSUMABLES: ConsumableDef[] = [
  {
    id: 'energy-drink',
    kind: 'energy',
    name: 'Энергетик',
    emoji: '🥤',
    description: `Восстанавливает +${BALANCE.energy.drinkEnergy} ⚡ (до ${BALANCE.energy.drinksPerDay} раз в сутки).`,
    shopPrice: 150,
    energy: BALANCE.energy.drinkEnergy,
  },
  {
    id: 'bait-worm',
    kind: 'bait',
    name: 'Червяк',
    emoji: '🪱',
    description: 'Немного повышает шанс редкой рыбы на 5 забросов.',
    shopPrice: 50,
    bait: { casts: 5, rarityBonus: 0.05 },
  },
  {
    id: 'bait-dough',
    kind: 'bait',
    name: 'Тесто',
    emoji: '🍞',
    description: 'Проверенная наживка на карповых, слегка повышает шанс редкой рыбы на 6 забросов.',
    shopPrice: 40,
    bait: { casts: 6, rarityBonus: 0.04 },
  },
  {
    id: 'bait-luminous',
    kind: 'bait',
    name: 'Светящаяся наживка',
    emoji: '🔆',
    description: 'Заметно повышает шанс редкой рыбы ночью на 5 забросов.',
    shopPrice: 90,
    bait: { casts: 5, rarityBonus: 0.08, timeOfDay: ['night'] },
  },
  {
    id: 'bait-golden',
    kind: 'bait',
    name: 'Золотая наживка',
    emoji: '✨',
    description: 'Сильно повышает шанс редкой рыбы на 3 заброса — шанс поймать Эпическую и выше заметно выше.',
    shopPrice: 220,
    bait: { casts: 3, rarityBonus: 0.15 },
  },
  {
    id: 'bait-shrimp',
    kind: 'bait',
    name: 'Креветка',
    emoji: '🦐',
    description: 'Любимое лакомство морских и глубоководных хищников на 6 забросов.',
    shopPrice: 70,
    bait: { casts: 6, speciesBoost: ['tuna', 'marlin', 'swordfish', 'giant-squid', 'monkfish'] },
  },
  {
    id: 'bait-abyssal-lure',
    kind: 'bait',
    name: 'Приманка из бездны',
    emoji: '🌌',
    description: 'Редчайшая наживка: резко повышает шанс редкой рыбы на 2 заброса. Добывается только в сундуках.',
    bait: { casts: 2, rarityBonus: 0.25 },
  },
];

export const CONSUMABLE_BY_ID: Record<string, ConsumableDef> = Object.fromEntries(CONSUMABLES.map((c) => [c.id, c]));
