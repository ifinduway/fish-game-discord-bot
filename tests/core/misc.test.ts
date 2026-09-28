import { describe, expect, it } from 'vitest';
import * as render from '../../src/render/index.js';
import { formatDuration, formatNumber, plural, progressBar, stars, customId } from '../../src/discord/ui.js';
import { getOrCreatePlayer } from '../../src/services/player.js';
import { announceCatch, announceText } from '../../src/services/announce.js';
import type { AnnouncePayload } from '../../src/core/context.js';
import { BALANCE } from '../../src/config/balance.js';
import { addCaughtFish, countCaughtFish, deleteCaughtFish, listCaughtFish, setFishStaked, addGearItem, setEquipped, getEquippedItems } from '../../src/db/repos/inventory.js';
import { FISH, FISH_BY_ID } from '../../src/data/fish.js';
import { LOCATIONS } from '../../src/data/locations.js';
import { CHESTS } from '../../src/data/chests.js';
import { GEAR } from '../../src/data/gear.js';
import { CONSUMABLES } from '../../src/data/consumables.js';
import { COSMETICS } from '../../src/data/cosmetics.js';
import { PASS_REWARDS } from '../../src/data/pass.js';
import { createTestContext, seedPlayer } from '../helpers.js';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe('render stubs', () => {
  it('return PNG buffers', async () => {
    const bufs = await Promise.all([
      render.renderProfileCard({ username: 'u', level: 1, xp: 0, xpNext: 50, energy: 100, maxEnergy: 100, coins: 0, pearls: 0, gear: [], stats: [], collection: { caught: 0, total: 1 } }),
      render.renderCatchCard({ username: 'u', species: { name: 'Карась', rarity: 'rare', description: '' }, weight: 1, quality: 3, perfect: true, value: 10, location: 'Пруд', firstOfSpecies: true }),
      render.renderChestCard({ chest: { name: 'Сундук' }, rewards: [{ label: '🪙 100', rarity: 'common', kind: 'coins' }] }),
      render.renderLeaderboardCard({ title: 'Топ', rows: [{ rank: 1, username: 'u', value: '1' }] }),
      render.renderBossCard({ name: 'Босс', hp: 5, maxHp: 10, expiresAt: 0, location: 'Озеро', top: [] }),
      render.renderBlackjackCard({ player: { cards: [{ rank: 'A', suit: '♠' }], total: 11 }, dealer: { cards: [], total: 0 }, result: null, stakeLabel: '🪙 10', payout: 0 }),
      render.renderSeasonSummaryCard({ seasonName: 'Зима', colors: ['#000000', '#ffffff'], categories: [] }),
    ]);
    for (const b of bufs) expect([...b.subarray(0, 4)]).toEqual(PNG_MAGIC);
  });
});

describe('ui helpers', () => {
  it('formats in Russian', () => {
    expect(formatDuration(45_000)).toBe('45 с');
    expect(formatDuration(65 * 60_000)).toBe('1 ч 5 мин');
    expect(formatDuration(2 * 86_400_000 + 3 * 3_600_000)).toBe('2 д 3 ч');
    expect(formatNumber(12345).replace(/\s/g, ' ')).toBe('12 345');
    expect(plural(1, 'рыба', 'рыбы', 'рыб')).toBe('рыба');
    expect(plural(3, 'рыба', 'рыбы', 'рыб')).toBe('рыбы');
    expect(plural(11, 'рыба', 'рыбы', 'рыб')).toBe('рыб');
    expect(progressBar(5, 10, 10)).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(stars(3)).toBe('★★★☆☆');
    expect(() => customId('x', 'y'.repeat(200))).toThrow();
  });
});

describe('player service & inventory', () => {
  it('getOrCreatePlayer creates with base energy and updates username', () => {
    const ctx = createTestContext();
    const p = getOrCreatePlayer(ctx, 'u1', 'Вася');
    expect(p.energy).toBe(BALANCE.energy.max);
    expect(p.cage_capacity).toBe(BALANCE.cage.baseCapacity);
    expect(p.level).toBe(1);
    expect(getOrCreatePlayer(ctx, 'u1', 'Петя').username).toBe('Петя');
  });

  it('caught fish add/list/count/stake/delete and equip', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const base = { userId: 'u1', speciesId: 'crucian', quality: 1, location: 'pond' as const, caughtAt: 1 };
    const a = addCaughtFish(ctx, { ...base, weight: 1, value: 10 });
    const b = addCaughtFish(ctx, { ...base, weight: 2, value: 30 });
    expect(countCaughtFish(ctx, 'u1')).toBe(2);
    expect(listCaughtFish(ctx, 'u1', { orderBy: 'value_desc' }).map((f) => f.id)).toEqual([b, a]);
    setFishStaked(ctx, 'u1', [b], true);
    expect(countCaughtFish(ctx, 'u1')).toBe(1);
    expect(countCaughtFish(ctx, 'u1', true)).toBe(2);
    expect(deleteCaughtFish(ctx, 'other', [a])).toBe(0);
    expect(deleteCaughtFish(ctx, 'u1', [a, b])).toBe(2);

    const g = addGearItem(ctx, 'u1', 'any_rod', 1);
    setEquipped(ctx, 'u1', 'rod', g);
    expect(getEquippedItems(ctx, 'u1').rod?.gear_id).toBe('any_rod');
  });
});

describe('announce', () => {
  it('is a no-op without ctx.announce and sends payloads when injected', async () => {
    const ctx = createTestContext();
    await announceText(ctx, 't', 'x'); // no throw
    const sent: AnnouncePayload[] = [];
    ctx.announce = async (p) => void sent.push(p);
    await announceText(ctx, 'Заголовок', 'Текст', 0xff0000);
    await announceCatch(ctx, {
      userId: 'u1',
      card: { username: 'u', species: { name: 'Царь пруда', rarity: 'legendary', description: '' }, weight: 10, quality: 4, perfect: false, value: 500, location: 'Пруд', firstOfSpecies: false },
    });
    expect(sent).toHaveLength(2);
    expect(sent[1]!.file?.name).toBe('catch.png');
    expect(sent[1]!.title).toContain('Легендарная');
  });
});

describe('data stubs', () => {
  it('have consistent lookups', () => {
    expect(LOCATIONS).toHaveLength(5);
    expect(new Set(FISH.map((f) => f.id)).size).toBe(FISH.length);
    for (const f of FISH) expect(FISH_BY_ID[f.id]).toBe(f);
    expect(CHESTS.map((c) => c.id)).toEqual(['wood', 'silver', 'gold']);
    expect(GEAR.length).toBeGreaterThan(0);
    expect(CONSUMABLES.length).toBeGreaterThan(0);
    expect(COSMETICS.length).toBeGreaterThan(0);
    expect(PASS_REWARDS).toHaveLength(BALANCE.pass.levels);
  });
});
