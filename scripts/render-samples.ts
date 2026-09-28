// Renders every WP6 card with realistic sample data to samples/*.png for visual QA (`yarn render:samples`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rarity } from '../src/data/types.js';
import {
  renderBlackjackCard,
  renderBossCard,
  renderCatchCard,
  renderChestCard,
  renderLeaderboardCard,
  renderProfileCard,
  renderSeasonSummaryCard,
  type BlackjackCardData,
  type Card,
  type CatchCardData,
} from '../src/render/index.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, 'samples');
mkdirSync(OUT_DIR, { recursive: true });

async function save(name: string, buf: Buffer): Promise<void> {
  const path = join(OUT_DIR, name);
  writeFileSync(path, buf);
  console.log(`✓ ${name} (${(buf.length / 1024).toFixed(1)} КБ)`);
}

const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

async function main(): Promise<void> {
  // ---- profile ----
  await save(
    'profile.png',
    await renderProfileCard({
      avatarUrl: undefined,
      username: 'РыболовСаня',
      level: 27,
      xp: 640,
      xpNext: 980,
      energy: 74,
      maxEnergy: 100,
      coins: 128450,
      pearls: 312,
      title: 'Повелитель глубин',
      frame: { name: 'Золотая рамка', gradient: ['#ffd45e', '#ff8c1a'] },
      background: { name: 'Закат', gradient: ['#132a3a', '#2a1a3a'] },
      gear: [
        { slot: 'rod', name: 'Карбоновое удилище', tier: 'epic', upgrade: 3 },
        { slot: 'reel', name: 'Катушка «Шторм»', tier: 'rare', upgrade: 1 },
        { slot: 'line', name: 'Плетёный шнур', tier: 'uncommon', upgrade: 0 },
        { slot: 'outfit', name: 'Костюм рыбака', tier: 'legendary', upgrade: 2 },
      ],
      stats: [
        { label: 'Поймано рыб', value: '1 842' },
        { label: 'Идеальных подсечек', value: '206' },
        { label: 'Общий вес', value: '3 410,5 кг' },
        { label: 'Рекордный улов', value: '18,4 кг' },
      ],
      collection: { caught: 46, total: 60 },
      seasonPass: { level: 18, max: 30 },
    }),
  );

  // ---- catch: one per rarity ----
  const catchBase: Omit<CatchCardData, 'species'> = {
    avatarUrl: undefined,
    username: 'РыболовСаня',
    weight: 4.235,
    quality: 4,
    perfect: true,
    value: 640,
    location: 'Глубоководье',
    firstOfSpecies: false,
    seasonal: false,
  };
  const speciesByRarity: Record<Rarity, { name: string; description: string; emoji: string }> = {
    common: { name: 'Плотва', description: 'Обычная речная рыба, встречается почти везде.', emoji: '🐟' },
    uncommon: { name: 'Окунь', description: 'Хищник с полосатым окрасом и колючими плавниками.', emoji: '🐠' },
    rare: { name: 'Судак', description: 'Осторожная рыба, любит холодную прозрачную воду.', emoji: '🐟' },
    epic: { name: 'Сом-великан', description: 'Огромный ночной охотник со дна реки.', emoji: '🐡' },
    legendary: { name: 'Золотой карп', description: 'По легенде исполняет одно желание рыбака.', emoji: '🐉' },
    mythic: { name: 'Левиафан глубин', description: 'Древнее существо, которое видели единицы.', emoji: '🐋' },
  };
  for (const rarity of RARITIES) {
    const sp = speciesByRarity[rarity];
    await save(
      `catch-${rarity}.png`,
      await renderCatchCard({
        ...catchBase,
        species: { name: sp.name, rarity, description: sp.description, emoji: sp.emoji },
        firstOfSpecies: rarity === 'legendary',
        record: rarity === 'mythic',
        seasonal: rarity === 'epic',
      }),
    );
  }

  // ---- chest: 1 and 5 rewards ----
  await save(
    'chest-1.png',
    await renderChestCard({
      chest: { name: 'Золотой сундук', emoji: '🎁' },
      rewards: [{ label: 'Легендарная удочка «Шторм»', rarity: 'legendary', kind: 'gear' }],
      pityLeft: 12,
    }),
  );
  await save(
    'chest-5.png',
    await renderChestCard({
      chest: { name: 'Серебряный сундук ×5', emoji: '🎁' },
      rewards: [
        { label: '450 монет', rarity: 'common', kind: 'coins' },
        { label: 'Энергетик ×3', rarity: 'uncommon', kind: 'item' },
        { label: 'Катушка «Прилив»', rarity: 'rare', kind: 'gear', duplicate: true },
        { label: 'Рамка «Океан»', rarity: 'epic', kind: 'cosmetic' },
        { label: 'Жемчужная леска', rarity: 'legendary', kind: 'gear' },
      ],
      pityLeft: undefined,
    }),
  );

  // ---- leaderboard ----
  await save(
    'leaderboard.png',
    await renderLeaderboardCard({
      title: 'Топ рыболовов недели',
      subtitle: 'По общему весу улова',
      highlightUserId: 'u5',
      rows: Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        username: [
          'РыболовСаня',
          'ТётяВаля',
          'КапитанНемо',
          'Удочка_Про',
          'МорскойВолк',
          'Клёвая_Марина',
          'ДедМорозов',
          'ЛещЛюбитель',
          'ЩукаХантер',
          'ТихийОмут',
        ][i]!,
        value: `${(320 - i * 24.3).toFixed(1)} кг`,
        userId: `u${i + 1}`,
        avatarUrl: undefined,
      })),
    }),
  );

  // ---- boss ----
  await save(
    'boss.png',
    await renderBossCard({
      name: 'Кракен Пучины',
      emoji: '🐙',
      hp: 42000,
      maxHp: 120000,
      expiresAt: Date.now() + 6 * 3600 * 1000,
      location: 'Глубоководье',
      status: 'active',
      top: [
        { username: 'КапитанНемо', damage: 18400 },
        { username: 'РыболовСаня', damage: 12950 },
        { username: 'МорскойВолк', damage: 8760 },
        { username: 'ТётяВаля', damage: 4200 },
        { username: 'ЩукаХантер', damage: 1500 },
      ],
    }),
  );

  // ---- blackjack: win / lose / push ----
  const bjBase: Omit<BlackjackCardData, 'result' | 'payout' | 'dealer' | 'hideDealerHole'> = {
    player: { cards: [card('K', '♠'), card('9', '♥')], total: 19 },
    stakeLabel: '🪙 500',
    username: 'РыболовСаня',
  };
  await save(
    'blackjack-win.png',
    await renderBlackjackCard({
      ...bjBase,
      dealer: { cards: [card('7', '♦'), card('9', '♣')], total: 16 },
      hideDealerHole: false,
      result: 'win',
      payout: 1000,
    }),
  );
  await save(
    'blackjack-lose.png',
    await renderBlackjackCard({
      player: { cards: [card('10', '♠'), card('9', '♥'), card('5', '♣')], total: 24 },
      dealer: { cards: [card('K', '♦'), card('8', '♣')], total: 18 },
      hideDealerHole: false,
      result: 'bust',
      payout: 0,
      stakeLabel: '🐟 3 рыбы (🪙 420)',
      username: 'ТётяВаля',
    }),
  );
  await save(
    'blackjack-push.png',
    await renderBlackjackCard({
      ...bjBase,
      player: { cards: [card('A', '♠'), card('K', '♥')], total: 21 },
      dealer: { cards: [card('A', '♦'), card('Q', '♣')], total: 21 },
      hideDealerHole: false,
      result: 'push',
      payout: 500,
    }),
  );

  // ---- season summary ----
  await save(
    'season.png',
    await renderSeasonSummaryCard({
      seasonName: 'Зимний сезон',
      emoji: '❄️',
      colors: ['#0d2a4a', '#1b4a63'],
      categories: [
        {
          title: 'Больше всех рыбы',
          winners: [
            { username: 'КапитанНемо', value: '812 шт' },
            { username: 'РыболовСаня', value: '740 шт' },
            { username: 'ТётяВаля', value: '695 шт' },
          ],
        },
        {
          title: 'Самый тяжёлый улов',
          winners: [
            { username: 'МорскойВолк', value: '24,8 кг' },
            { username: 'ЩукаХантер', value: '19,2 кг' },
          ],
        },
        {
          title: 'Больше всего боссов',
          winners: [
            { username: 'КапитанНемо', value: '14' },
            { username: 'ДедМорозов', value: '11' },
            { username: 'ЛещЛюбитель', value: '9' },
            { username: 'ТихийОмут', value: '7' },
          ],
        },
        {
          title: 'Блэкджек: чистая прибыль',
          winners: [
            { username: 'Удочка_Про', value: '🪙 24 500' },
            { username: 'Клёвая_Марина', value: '🪙 18 200' },
          ],
        },
      ],
    }),
  );

  console.log(`\nГотово: все образцы сохранены в ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
