// Render API (plan §4.6). WP0 = stub bodies; WP6 replaces them with real cards (same names & signatures).
import { RARITY_INFO } from '../data/types.js';
import { renderStub } from './stub.js';
export * from './types.js';
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
export const renderProfileCard = (d) => renderStub(`${d.username} — ур. ${d.level}`, [`🪙 ${d.coins}  🐚 ${d.pearls}`]);
export const renderCatchCard = (d) => renderStub(`${d.species.name} ${d.weight} кг`, [`★${d.quality} · ${d.value} монет`], hex(RARITY_INFO[d.species.rarity].color));
export const renderChestCard = (d) => renderStub(d.chest.name, d.rewards.map((r) => r.label), hex(RARITY_INFO[d.rewards[0]?.rarity ?? 'common'].color));
export const renderLeaderboardCard = (d) => renderStub(d.title, d.rows.slice(0, 10).map((r) => `${r.rank}. ${r.username} — ${r.value}`));
export const renderBossCard = (d) => renderStub(d.name, [`HP ${d.hp}/${d.maxHp}`], '#5a1e1e');
export const renderBlackjackCard = (d) => renderStub('Блэкджек', [`Игрок: ${d.player.total} · Дилер: ${d.dealer.total}`, `${d.result ?? '…'} · ${d.stakeLabel}`], '#0b5d1e');
export const renderSeasonSummaryCard = (d) => renderStub(d.seasonName, d.categories.map((c) => c.title), d.colors[0]);
//# sourceMappingURL=index.js.map