// STUB (WP0) — WP1 replaces the contents but must keep export names/types.
import { BALANCE } from '../config/balance.js';
export const CONSUMABLES = [
    { id: 'energy_drink', kind: 'energy', name: 'Энергетик', emoji: '🥤', description: `+${BALANCE.energy.drinkEnergy} ⚡`, shopPrice: 150, energy: BALANCE.energy.drinkEnergy },
    { id: 'bait_worm', kind: 'bait', name: 'Червяк', emoji: '🪱', description: 'Немного повышает шанс редкой рыбы на 5 забросов.', shopPrice: 50, bait: { casts: 5, rarityBonus: 0.05 } },
];
export const CONSUMABLE_BY_ID = Object.fromEntries(CONSUMABLES.map((c) => [c.id, c]));
//# sourceMappingURL=consumables.js.map