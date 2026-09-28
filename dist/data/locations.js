// STUB (WP0) — WP1 may refine texts but must keep export names/types.
import { BALANCE } from '../config/balance.js';
const U = BALANCE.locationUnlockLevels;
export const LOCATIONS = [
    { id: 'pond', name: 'Пруд', emoji: '🪷', unlockLevel: U.pond, description: 'Тихий пруд за деревней.', junkChance: 0.1 },
    { id: 'river', name: 'Река', emoji: '🏞️', unlockLevel: U.river, description: 'Быстрое течение и хищная рыба.', junkChance: 0.08 },
    { id: 'lake', name: 'Озеро', emoji: '🌊', unlockLevel: U.lake, description: 'Глубокое лесное озеро.', junkChance: 0.07 },
    { id: 'sea', name: 'Море', emoji: '⛵', unlockLevel: U.sea, description: 'Солёные волны и крупный улов.', junkChance: 0.06 },
    { id: 'deep', name: 'Глубоководье', emoji: '🌑', unlockLevel: U.deep, description: 'Тьма, где живут легенды.', junkChance: 0.05 },
];
export const LOCATION_BY_ID = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));
//# sourceMappingURL=locations.js.map