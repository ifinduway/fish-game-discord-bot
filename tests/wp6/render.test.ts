// WP6 rendering tests: every renderer returns a valid PNG buffer for realistic + edge-case data, entirely
// network-free (no avatarUrl, or an invalid one that must fall back quickly instead of hanging/throwing).
import { describe, expect, it } from 'vitest';
import {
  renderBlackjackCard,
  renderBossCard,
  renderCatchCard,
  renderChestCard,
  renderLeaderboardCard,
  renderProfileCard,
  renderSeasonSummaryCard,
} from '../../src/render/index.js';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function expectPng(buf: Buffer): void {
  expect(Buffer.isBuffer(buf)).toBe(true);
  expect([...buf.subarray(0, 8)]).toEqual(PNG_MAGIC);
  expect(buf.length).toBeGreaterThan(100);
}

describe('render/profile', () => {
  it('renders a PNG with no avatar (fallback initial circle)', async () => {
    const buf = await renderProfileCard({
      username: 'Тестов',
      level: 5,
      xp: 10,
      xpNext: 100,
      energy: 50,
      maxEnergy: 100,
      coins: 100,
      pearls: 5,
      gear: [],
      stats: [],
      collection: { caught: 0, total: 10 },
    });
    expectPng(buf);
  });

  it('renders with an invalid avatarUrl without throwing or hanging', async () => {
    const buf = await renderProfileCard({
      avatarUrl: 'http://127.0.0.1:1/does-not-exist.png',
      username: 'Тестов',
      level: 1,
      xp: 0,
      xpNext: 50,
      energy: 100,
      maxEnergy: 100,
      coins: 0,
      pearls: 0,
      title: 'Новичок',
      frame: { name: 'Простая', color: '#ffffff' },
      background: { name: 'Синий', color: '#123456' },
      gear: [{ slot: 'rod', name: 'Удочка', tier: 'common', upgrade: 0 }],
      stats: [{ label: 'Тест', value: '1' }],
      collection: { caught: 1, total: 1 },
      seasonPass: { level: 1, max: 30 },
    });
    expectPng(buf);
  }, 10_000);
});

describe('render/catch', () => {
  it.each(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const)('renders a PNG for %s rarity', async (rarity) => {
    const buf = await renderCatchCard({
      username: 'Тестов',
      species: { name: 'Щука', rarity, description: 'Хищная рыба' },
      weight: 2.5,
      quality: 4,
      perfect: true,
      value: 50,
      location: 'Река',
      firstOfSpecies: true,
      record: true,
      seasonal: true,
    });
    expectPng(buf);
  });
});

describe('render/chest', () => {
  it('renders a single-reward chest card', async () => {
    const buf = await renderChestCard({
      chest: { name: 'Деревянный сундук' },
      rewards: [{ label: '100 монет', rarity: 'common', kind: 'coins' }],
    });
    expectPng(buf);
  });

  it('renders a five-reward chest card with pity counter', async () => {
    const buf = await renderChestCard({
      chest: { name: 'Золотой сундук' },
      rewards: [
        { label: '100 монет', rarity: 'common', kind: 'coins' },
        { label: 'Энергетик', rarity: 'uncommon', kind: 'item' },
        { label: 'Катушка', rarity: 'rare', kind: 'gear', duplicate: true },
        { label: 'Рамка', rarity: 'epic', kind: 'cosmetic' },
        { label: 'Удочка', rarity: 'legendary', kind: 'gear' },
      ],
      pityLeft: 3,
    });
    expectPng(buf);
  });

  it('renders gracefully with zero rewards', async () => {
    const buf = await renderChestCard({ chest: { name: 'Пустой сундук' }, rewards: [] });
    expectPng(buf);
  });
});

describe('render/leaderboard', () => {
  it('renders 10 rows with a highlighted user and network-free avatars', async () => {
    const buf = await renderLeaderboardCard({
      title: 'Топ недели',
      subtitle: 'По весу',
      highlightUserId: 'u3',
      rows: Array.from({ length: 10 }, (_, i) => ({
        rank: i + 1,
        username: `Игрок${i + 1}`,
        value: `${(100 - i * 5).toFixed(1)} кг`,
        userId: `u${i + 1}`,
      })),
    });
    expectPng(buf);
  });

  it('renders gracefully with zero rows', async () => {
    const buf = await renderLeaderboardCard({ title: 'Пусто', rows: [] });
    expectPng(buf);
  });
});

describe('render/boss', () => {
  it('renders an active boss card', async () => {
    const buf = await renderBossCard({
      name: 'Гигантский сом',
      hp: 500,
      maxHp: 1000,
      expiresAt: Date.now() + 3_600_000,
      location: 'Озеро',
      status: 'active',
      top: [
        { username: 'Игрок1', damage: 300 },
        { username: 'Игрок2', damage: 150 },
      ],
    });
    expectPng(buf);
  });

  it('renders a defeated boss card with no contributors', async () => {
    const buf = await renderBossCard({
      name: 'Гигантский сом',
      hp: 0,
      maxHp: 1000,
      expiresAt: Date.now() - 1000,
      location: 'Озеро',
      status: 'defeated',
      top: [],
    });
    expectPng(buf);
  });
});

describe('render/blackjack', () => {
  it('renders a hidden-hole in-progress hand', async () => {
    const buf = await renderBlackjackCard({
      player: { cards: [{ rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }], total: 21 },
      dealer: { cards: [{ rank: '9', suit: '♦' }, { rank: '2', suit: '♣' }], total: 11 },
      hideDealerHole: true,
      result: null,
      stakeLabel: '🪙 150',
      payout: 0,
      username: 'Тестов',
    });
    expectPng(buf);
  });

  it.each(['win', 'blackjack', 'lose', 'push', 'bust'] as const)('renders a finished hand: %s', async (result) => {
    const buf = await renderBlackjackCard({
      player: { cards: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }], total: 19 },
      dealer: { cards: [{ rank: 'K', suit: '♦' }, { rank: '8', suit: '♣' }], total: 18 },
      hideDealerHole: false,
      result,
      stakeLabel: '🐟 2 рыбы (🪙 80)',
      payout: result === 'lose' || result === 'bust' ? 0 : 200,
    });
    expectPng(buf);
  });
});

describe('render/season', () => {
  it('renders a multi-category season summary', async () => {
    const buf = await renderSeasonSummaryCard({
      seasonName: 'Летний сезон',
      colors: ['#123456', '#654321'],
      categories: [
        { title: 'Больше всех рыбы', winners: [{ username: 'Игрок1', value: '100' }] },
        { title: 'Самый тяжёлый улов', winners: [] },
      ],
    });
    expectPng(buf);
  });

  it('renders gracefully with zero categories', async () => {
    const buf = await renderSeasonSummaryCard({ seasonName: 'Пустой сезон', colors: ['#000000', '#111111'], categories: [] });
    expectPng(buf);
  });
});
