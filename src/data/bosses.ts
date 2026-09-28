// WP1: server bosses — one per lake/sea/deep. Keep export names/types stable.
import type { BossDef } from './types.js';

export const BOSSES: BossDef[] = [
  { id: 'lake-legend', name: 'Легенда озера', emoji: '🐉', location: 'lake', hpPerPlayer: 500, description: 'Древний сом, которого никто не видел целиком.' },
  { id: 'sea-kraken', name: 'Морской кракен', emoji: '🐙', location: 'sea', hpPerPlayer: 800, description: 'Гигантский спрут, топящий рыбацкие лодки.' },
  { id: 'abyss-devourer', name: 'Пожиратель бездны', emoji: '🦑', location: 'deep', hpPerPlayer: 1200, description: 'Существо из самых тёмных глубин, о котором ходят страшные легенды.' },
];

export const BOSS_BY_ID: Record<string, BossDef> = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
