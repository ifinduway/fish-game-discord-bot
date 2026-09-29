// Acceptance-criteria traceability matrix: one test per AC of `.omc/specs/deep-interview-discord-fishing-bot.md`
// (quoted in Russian). Everything is driven through services with the real subscribers + jobs; the parts that need
// a live Discord gateway are `it.todo(... — requires live Discord)`.
import { readFileSync } from 'node:fs';
import type { MessageComponentInteraction } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { AnnouncePayload } from '../../src/core/context.js';
import { createContext } from '../../src/core/context.js';
import { seededRng } from '../../src/core/rng.js';
import { weekKey } from '../../src/core/time.js';
import { CHALLENGE_TEMPLATES } from '../../src/data/challenges.js';
import { CHEST_BY_ID, CHESTS } from '../../src/data/chests.js';
import { CONSUMABLES } from '../../src/data/consumables.js';
import { FISH } from '../../src/data/fish.js';
import { GEAR } from '../../src/data/gear.js';
import { LOCATIONS } from '../../src/data/locations.js';
import { PASS_REWARDS } from '../../src/data/pass.js';
import { GEAR_SLOTS, RARITIES, rarityAtLeast, type FishSpecies, type Rarity } from '../../src/data/types.js';
import { prepare } from '../../src/db/database.js';
import { countCaughtFish, hasCosmetic, listCaughtFish, listGearItems } from '../../src/db/repos/inventory.js';
import { getPlayer, setEnergy } from '../../src/db/repos/players.js';
import * as stats from '../../src/db/repos/stats.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import blackjackCommand, { components as bjComponents } from '../../src/discord/commands/blackjack.js';
import { components as fishComponents } from '../../src/discord/commands/fish.js';
import profileCommand from '../../src/discord/commands/profile.js';
import adminCommand from '../../src/discord/commands/admin.js';
import { commandsJson, loadRegistry } from '../../src/discord/registry.js';
import { NOT_OWNER_TEXT } from '../../src/discord/ui.js';
import { handValue, type Card } from '../../src/game/blackjack.js';
import { rarityWeights, rollSpecies, type CastRoll } from '../../src/game/catch.js';
import { fishValue } from '../../src/game/economy.js';
import { LEADERBOARD_CATEGORIES } from '../../src/game/leaderboard.js';
import { renderBossCard, renderChestCard, renderLeaderboardCard } from '../../src/render/index.js';
import { loadJobs, runDueJobs } from '../../src/scheduler/index.js';
import { adminEndSeason, adminSpawnBoss, giveReward, takeCurrency } from '../../src/services/admin.js';
import { announceCatch } from '../../src/services/announce.js';
import { act, BlackjackError, getActiveHand, getHand, startCoins, startFish } from '../../src/services/blackjack.js';
import { buildBossCard, endBoss, getActiveBoss, getBoss } from '../../src/services/boss.js';
import { applyProgress, currentPeriods, listChallenges } from '../../src/services/challenges.js';
import { chestOdds, ChestError, openChests } from '../../src/services/chest.js';
import { getCollectionPage } from '../../src/services/collection.js';
import { claimDaily, sellFish } from '../../src/services/economy.js';
import {
  biteDelay,
  markBiteShown,
  pressHook,
  pressReel,
  startCast,
  startReelRound,
  type FishingStep,
} from '../../src/services/fishing.js';
import { getLeaderboard, runWeeklyReset } from '../../src/services/leaderboard.js';
import { ensurePlayerReady, getPlayerState } from '../../src/services/player-state.js';
import { addXp } from '../../src/services/player.js';
import { addPassXp, getActiveSeason, getPassProgress, seasonTitleId } from '../../src/services/season.js';
import { ensureServerGoal, getPlayerStatsView, getServerGoal, getServerOverview } from '../../src/services/server.js';
import { equipGear, listOwnedGear } from '../../src/services/shop.js';
import { createGame, playCast, resetGlobals, type Game } from './_harness.js';

afterEach(() => resetGlobals());

// ───────────────────────── helpers ─────────────────────────

const HOUR = 3_600_000;
const isPng = (b: Buffer): boolean => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
const regular = (r: Rarity, loc?: string): FishSpecies => FISH.find((f) => f.rarity === r && !f.seasonTheme && (!loc || f.locations.includes(loc as never)))!;
const fishRoll = (species: FishSpecies, weight = (species.minWeight + species.maxWeight) / 2): CastRoll => ({ kind: 'fish', species, weight, snap: false });
const card = (rank: Card['rank'], suit: Card['suit'] = '♠'): Card => ({ rank, suit });

/** Forced-outcome cast through the fishing service; `press` picks the hook timing; reel presses are correct unless `wrong`. */
function cast(g: Game, uid: string, outcome: CastRoll, press: 'perfect' | 'ok' | 'late' = 'ok', opts: { location?: string; wrongReel?: number } = {}): FishingStep {
  const { ctx } = g;
  const r = startCast(ctx, uid, { forceOutcome: outcome, location: (opts.location ?? null) as never });
  if (!r.ok) throw new Error(`cast failed: ${r.error.code}`);
  const sid = r.session.id;
  ctx.clock.advance(biteDelay(ctx));
  markBiteShown(sid, ctx.clock.now());
  const w = r.session.window;
  ctx.clock.advance(press === 'perfect' ? Math.floor(w.perfectMs / 2) : press === 'ok' ? Math.ceil(w.perfectMs) + 100 : w.totalMs + 100);
  let step = pressHook(ctx, sid, ctx.clock.now());
  let wrong = opts.wrongReel ?? 0;
  while (step.kind === 'reel') {
    startReelRound(sid, ctx.clock.now());
    ctx.clock.advance(500);
    const target = step.target;
    const dir = wrong-- > 0 ? (target === 'left' ? 'right' : 'left') : target;
    step = pressReel(ctx, sid, step.round - 1, dir, ctx.clock.now());
  }
  ctx.clock.advance(1000);
  return step;
}

function fakeComponent(userId: string, opts: { button?: boolean } = {}) {
  const replies: string[] = [];
  const edits: unknown[] = [];
  const i = {
    user: { id: userId, username: `user-${userId}`, displayName: `user-${userId}`, bot: false, displayAvatarURL: () => '' },
    replied: false,
    deferred: false,
    isButton: () => opts.button !== false,
    isStringSelectMenu: () => opts.button === false,
    reply: async (p: { content: string }) => void replies.push(p.content),
    followUp: async (p: { content: string }) => void replies.push(p.content),
    deferUpdate: async () => undefined,
    editReply: async (p: unknown) => void edits.push(p),
  };
  return { i: i as unknown as MessageComponentInteraction, replies, edits };
}

async function game(seed = 42, now?: number): Promise<Game> {
  resetGlobals();
  return createGame({ seed, now });
}

const SPEC = readFileSync(new URL('../../.omc/specs/deep-interview-discord-fishing-bot.md', import.meta.url), 'utf8');

describe('Acceptance Criteria (spec) — traceability matrix', () => {
  it('spec lists exactly the 24 acceptance criteria covered below', () => {
    const acs = SPEC.split('## Acceptance Criteria')[1]!.split('\n## ')[0]!.split('\n').filter((l) => l.startsWith('- [ ]'));
    expect(acs).toHaveLength(24);
  });

  // AC1
  it('«`yarn build` проходит без ошибок TS (strict). `yarn test` зелёный.» — strict TS config + every slash command loads with valid JSON', async () => {
    const tsconfig = JSON.parse(readFileSync(new URL('../../tsconfig.json', import.meta.url), 'utf8')) as { compilerOptions: { strict: boolean } };
    expect(tsconfig.compilerOptions.strict).toBe(true);
    const reg = await loadRegistry();
    const json = commandsJson(reg);
    const names = json.map((c) => c.name).sort();
    // spec §14: the full command list
    expect(names).toEqual(
      ['admin', 'blackjack', 'boss', 'buy', 'challenges', 'chest', 'collection', 'daily', 'equip', 'fish', 'gear', 'help', 'inventory', 'locations', 'pass', 'profile', 'sell', 'season', 'server', 'shop', 'stats', 'top', 'upgrade', 'use'].sort(),
    );
  });
  it.todo('«`yarn dev` запускает бота с токеном из `.env`, slash-команды регистрируются на `GUILD_ID`» — requires live Discord');

  // AC2
  it('«`/fish` списывает 8 ⚡. Если энергии не хватает, приходит отказ с временем до восстановления. Регенерация 1 ⚡ / 2.4 мин проверяется юнит-тестом с подменой времени.»', async () => {
    const g = await game();
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    const e0 = getPlayerState(ctx, 'u1').energy;
    const r = startCast(ctx, 'u1', { forceOutcome: fishRoll(regular('common', 'pond')) });
    expect(r.ok).toBe(true);
    expect(e0 - getPlayerState(ctx, 'u1').energy).toBeCloseTo(8);
    resetGlobals();
    setEnergy(ctx, 'u1', 5, ctx.clock.now());
    const refused = startCast(ctx, 'u1');
    expect(refused).toMatchObject({ ok: false, error: { code: 'no_energy', cost: 8, msUntil: 3 * 144_000 } });
    ctx.clock.advance(144_000); // 2.4 min
    expect(getPlayerState(ctx, 'u1').energy).toBeCloseTo(6);
    ctx.clock.advance(2 * 144_000);
    expect(startCast(ctx, 'u1', { forceOutcome: fishRoll(regular('common', 'pond')) }).ok).toBe(true);
  });

  // AC3
  it('«Кнопка «Подсечь» появляется через 1.5–5 с. Нажатие вовремя даёт улов, в первые 40% окна — идеальная подсечка (+1★). Опоздание — «Сорвалась» и возврат 4 ⚡. Чужой пользователь нажать кнопку не может.»', async () => {
    const g = await game();
    const { ctx } = g;
    const delays = Array.from({ length: 2000 }, () => biteDelay(ctx));
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(1500);
    expect(Math.max(...delays)).toBeLessThanOrEqual(5000);
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(3000);

    // same seed, same forced fish: perfect press = quality +1★ (capped at 5) and +10% weight vs an ordinary press
    const sp = regular('common', 'pond');
    const a = await game(7);
    const b = await game(7);
    const ok = cast(a, 'u1', fishRoll(sp, sp.minWeight), 'ok');
    const perfect = cast(b, 'u1', fishRoll(sp, sp.minWeight), 'perfect');
    expect(ok.kind).toBe('caught');
    expect(perfect.kind).toBe('caught');
    if (ok.kind !== 'caught' || perfect.kind !== 'caught') return;
    expect(ok.result.perfect).toBe(false);
    expect(perfect.result.perfect).toBe(true);
    expect(perfect.result.quality).toBe(Math.min(5, ok.result.quality + 1));
    expect(perfect.result.weight).toBeCloseTo(ok.result.weight * 1.1, 1);

    // late → escaped, 4 energy back
    ensurePlayerReady(ctx, 'u2');
    const before = getPlayerState(ctx, 'u2').energy;
    const late = cast(g, 'u2', fishRoll(sp), 'late');
    expect(late).toMatchObject({ kind: 'escaped', reason: 'late', refund: 4 });
    const net = before - getPlayerState(ctx, 'u2').energy; // 8 spent − 4 refunded (+ a few seconds of regen)
    expect(net).toBeGreaterThan(3.9);
    expect(net).toBeLessThanOrEqual(4);

    // another user presses the hook button → rejected, the session is untouched
    const r = startCast(ctx, 'u1', { forceOutcome: fishRoll(sp) });
    if (!r.ok) throw new Error('cast failed');
    markBiteShown(r.session.id, ctx.clock.now());
    const { i, replies } = fakeComponent('intruder');
    await fishComponents[0]!.handle(i, ['hook', r.session.id], ctx);
    expect(replies).toEqual([NOT_OWNER_TEXT]);
    expect(r.session.phase).toBe('bite');
  });

  // AC4
  it('«Для Редкой+ рыбы запускается вываживание из 2–3 раундов. Две ошибки — рыба уходит (при леске без бонуса).»', async () => {
    const g = await game();
    ensurePlayerReady(g.ctx, 'u1');
    const rare = regular('rare');
    const epic = regular('epic');
    // rounds: rare → 2, epic → 3 (starter line has no mistake bonus)
    const r1 = startCast(g.ctx, 'u1', { forceOutcome: fishRoll(rare, rare.minWeight) });
    if (!r1.ok) throw new Error('cast failed');
    markBiteShown(r1.session.id, g.ctx.clock.now());
    const s1 = pressHook(g.ctx, r1.session.id, g.ctx.clock.now() + 900);
    expect(s1).toMatchObject({ kind: 'reel', round: 1, rounds: 2, escapeAt: 2 });
    resetGlobals();
    const r2 = startCast(g.ctx, 'u1', { forceOutcome: fishRoll(epic, epic.minWeight) });
    if (!r2.ok) throw new Error('cast failed');
    markBiteShown(r2.session.id, g.ctx.clock.now());
    expect(pressHook(g.ctx, r2.session.id, g.ctx.clock.now() + 900)).toMatchObject({ kind: 'reel', rounds: 3 });
    resetGlobals();
    // one mistake → still caught (lower quality); two mistakes → escaped
    expect(cast(g, 'u1', fishRoll(rare, rare.minWeight), 'ok', { wrongReel: 1 })).toMatchObject({ kind: 'caught', result: { mistakes: 1 } });
    expect(cast(g, 'u1', fishRoll(rare, rare.minWeight), 'ok', { wrongReel: 2 })).toMatchObject({ kind: 'escaped', reason: 'reel' });
  });

  // AC5
  it('«Выбор вида учитывает локацию, время суток, уровень и бонусы снаряжения. Распределение редкостей на 100k симуляций (seeded RNG) укладывается в ±10% от таблицы шансов.»', () => {
    const rng = seededRng(100_000);
    const rc = { location: 'lake' as const, timeOfDay: 'day' as const, level: 50, seasonTheme: null, rarityBonus: 0, rarityMultiplier: 1 };
    const counts = new Map<Rarity, number>();
    const N = 100_000;
    for (let n = 0; n < N; n++) {
      const s = rollSpecies(rng, FISH, rc)!;
      expect(s.locations).toContain('lake');
      if (s.times?.length) expect(s.times).toContain('day');
      counts.set(s.rarity, (counts.get(s.rarity) ?? 0) + 1);
    }
    const pool = FISH.filter((f) => f.locations.includes('lake') && !f.seasonTheme && (!f.times?.length || f.times.includes('day')));
    const weights = rarityWeights(pool.map((f) => f.rarity));
    const total = weights.reduce((s, w) => s + w.weight, 0);
    for (const { item, weight } of weights) {
      const expected = (weight / total) * N;
      const got = counts.get(item) ?? 0;
      expect(Math.abs(got - expected) / expected, `${item}: ${got} vs ${expected.toFixed(0)}`).toBeLessThanOrEqual(0.1);
    }
    // level gates rarities; rod/bait bonus shifts toward rare+; time of day filters species
    const low = Array.from({ length: 5000 }, () => rollSpecies(rng, FISH, { ...rc, level: 1 })!);
    expect(low.every((s) => !rarityAtLeast(s.rarity, 'epic'))).toBe(true);
    const share = (bonus: number): number => {
      let rare = 0;
      for (let n = 0; n < 20_000; n++) if (rarityAtLeast(rollSpecies(rng, FISH, { ...rc, rarityBonus: bonus })!.rarity, 'rare')) rare++;
      return rare / 20_000;
    };
    expect(share(0.5)).toBeGreaterThan(share(0) * 1.2);
    const nightOnly = FISH.filter((f) => f.times?.length && !f.times.includes('day') && f.locations.includes('lake') && !f.seasonTheme);
    const dayRolls = new Set(Array.from({ length: 5000 }, () => rollSpecies(rng, FISH, rc)!.id));
    for (const f of nightOnly) expect(dayRolls.has(f.id)).toBe(false);
  });

  // AC6
  it('«Снаряжение меняет характеристики: максимум энергии, стоимость заброса, шанс редкости, окно подсечки. Каждый эффект покрыт тестом.»', async () => {
    const g = await game();
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    const base = getPlayerState(ctx, 'u1');
    const r0 = startCast(ctx, 'u1', { forceOutcome: fishRoll(regular('common', 'pond')) });
    if (!r0.ok) throw new Error('cast failed');
    resetGlobals();
    addXp(ctx, 'u1', 100_000); // unlock high-tier gear
    for (const id of ['outfit-rare', 'rod-rare']) giveReward(ctx, 'admin', 'u1', 'gear', id, 1);
    for (const g2 of listOwnedGear(ctx, 'u1')) if (['outfit-rare', 'rod-rare'].includes(g2.def.id)) equipGear(ctx, 'u1', g2.item.id);
    const geared = getPlayerState(ctx, 'u1');
    expect(geared.maxEnergy).toBe(BALANCE.energy.max + 15); // outfit-rare maxEnergy
    expect(base.maxEnergy).toBe(BALANCE.energy.max + 5); // starter outfit
    expect(geared.castCost).toBe(BALANCE.energy.castCost - 1); // outfit-rare castCostReduction
    expect(geared.stats.rarityBonus).toBeCloseTo(0.09); // rod-rare
    const r1 = startCast(ctx, 'u1', { forceOutcome: fishRoll(regular('common', 'pond')), location: 'pond' });
    if (!r1.ok) throw new Error('cast failed');
    expect(r1.session.window.baseMs - r0.session.window.baseMs).toBe(350 - 100); // rod-rare vs starter rod biteWindowMs
    expect(r1.session.castCost).toBe(7);
  });

  // AC7
  it('«`/sell` начисляет монеты по формуле `base × (вес/средний) × качество` в транзакции. Садок на 50 мест блокирует `/fish` при переполнении.»', async () => {
    const g = await game();
    const { ctx } = g;
    const sp = regular('uncommon', 'pond');
    const step = cast(g, 'u1', fishRoll(sp, sp.maxWeight), 'ok');
    if (step.kind !== 'caught') throw new Error(step.kind);
    const mult = BALANCE.fishing.qualityMultipliers[step.result.quality - 1]!;
    const expected = Math.round(sp.basePrice * (step.result.weight / ((sp.minWeight + sp.maxWeight) / 2)) * mult);
    expect(step.result.value).toBe(expected);
    const coins = getBalance(ctx, 'u1').coins;
    expect(sellFish(ctx, 'u1', { kind: 'all' })).toMatchObject({ count: 1, coins: expected });
    expect(getBalance(ctx, 'u1').coins).toBe(coins + expected);
    // cage: 50 places
    expect(getPlayer(ctx, 'u1')!.cage_capacity).toBe(50);
    const small = regular('common', 'pond');
    for (let n = 0; n < 50; n++) {
      ctx.clock.advance(20 * 60_000);
      expect(cast(g, 'u1', fishRoll(small, small.minWeight)).kind).toBe('caught');
    }
    expect(countCaughtFish(ctx, 'u1')).toBe(50);
    ctx.clock.advance(HOUR);
    expect(startCast(ctx, 'u1')).toMatchObject({ ok: false, error: { code: 'cage_full', count: 50, capacity: 50 } });
    sellFish(ctx, 'u1', { kind: 'fish', fishId: listCaughtFish(ctx, 'u1')[0]!.id });
    expect(startCast(ctx, 'u1').ok).toBe(true);
  });

  // AC8
  it('«Жемчуг начисляется из всех источников в таблице §5 и не начисляется за простую продажу рыбы.»', async () => {
    const g = await game(3);
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    const pearls = (): number => getBalance(ctx, 'u1').pearls;
    // daily login: 3 + 1 per streak day
    let p = pearls();
    expect(claimDaily(ctx, 'u1')).toMatchObject({ ok: true, pearls: 3 });
    expect(pearls() - p).toBe(3);
    // first catch of a new species: 1/2/4/8/15/30 by rarity
    expect(BALANCE.firstCatchPearls).toEqual({ common: 1, uncommon: 2, rare: 4, epic: 8, legendary: 15, mythic: 30 });
    p = pearls();
    const first = cast(g, 'u1', fishRoll(regular('common', 'pond'), 0.3));
    expect(first).toMatchObject({ kind: 'caught', result: { firstOfSpecies: true, pearls: 1 } });
    // simple sale: no pearls (the fish is cheap, so no sell challenge can complete)
    const beforeSale = pearls();
    expect(sellFish(ctx, 'u1', { kind: 'all' }).count).toBe(1);
    expect(pearls()).toBe(beforeSale);
    // rare treasure drop (~1%, 1–3 pearls)
    expect(BALANCE.fishing.treasureChance).toBe(0.01);
    p = pearls();
    expect(cast(g, 'u1', { kind: 'treasure', coins: 0, pearls: 2 })).toMatchObject({ kind: 'treasure', pearls: 2 });
    expect(pearls() - p).toBe(2);
    // daily challenges (2–3 each) + all-3 bonus (+5)
    const dailies = listChallenges(ctx, 'u1').filter((c) => c.scope === 'daily');
    expect(dailies).toHaveLength(3);
    for (const t of CHALLENGE_TEMPLATES.filter((t) => t.scope === 'daily' && t.reward.pearls)) expect(t.reward.pearls).toBeGreaterThanOrEqual(2);
    for (const t of CHALLENGE_TEMPLATES.filter((t) => t.scope === 'daily')) expect(t.reward.pearls ?? 0).toBeLessThanOrEqual(3);
    for (const t of CHALLENGE_TEMPLATES.filter((t) => t.scope === 'weekly')) {
      expect(t.reward.pearls).toBeGreaterThanOrEqual(10);
      expect(t.reward.pearls).toBeLessThanOrEqual(15);
    }
    p = pearls();
    let expectedGain = 0;
    for (const c of dailies.filter((d) => !d.completed)) {
      expectedGain += c.reward.pearls ?? 0;
      applyProgress(ctx, 'u1', c.metric!, c.target, c.param ? { location: c.param as never, weight: Number(c.param) + 1 } : {});
    }
    expect(listChallenges(ctx, 'u1').filter((c) => c.scope === 'daily').every((c) => c.completed)).toBe(true);
    expect(pearls() - p).toBeGreaterThanOrEqual(expectedGain + BALANCE.challenges.allDailyBonusPearls);
    // weekly challenge
    const weekly = listChallenges(ctx, 'u1').find((c) => c.scope === 'weekly' && !c.completed && !c.param)!;
    p = pearls();
    applyProgress(ctx, 'u1', weekly.metric!, weekly.target);
    expect(pearls() - p).toBeGreaterThanOrEqual(weekly.reward.pearls!);
    // season pass levels
    p = pearls();
    addPassXp(ctx, 'u1', 3 * BALANCE.pass.xpPerLevel);
    expect(pearls() - p).toBeGreaterThanOrEqual(PASS_REWARDS.filter((r) => r.level <= 3).reduce((s, r) => s + (r.reward.pearls ?? 0), 0));
    // boss participation / top damage: 10–50
    const tiers = BALANCE.boss.rewardTiers.map((t) => t.pearls);
    expect(Math.min(...tiers)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...tiers)).toBeLessThanOrEqual(50);
    addXp(ctx, 'u1', 100_000);
    adminSpawnBoss(ctx, 'admin', 'lake-legend');
    p = pearls();
    const boss = getActiveBoss(ctx)!;
    const heavy = regular('common', 'lake');
    for (let n = 0; n < 200 && getBoss(ctx, boss.id)!.status === 'active'; n++) {
      ctx.clock.advance(10 * 60_000);
      cast(g, 'u1', fishRoll(heavy, heavy.maxWeight), 'perfect', { location: 'lake' });
      sellFish(ctx, 'u1', { kind: 'all' });
    }
    expect(getBoss(ctx, boss.id)!.status).toBe('defeated');
    expect(pearls() - p).toBeGreaterThanOrEqual(Math.max(...tiers)); // sole participant = top tier
  });

  // AC9
  it('«`/chest open` списывает жемчуг, показывает прокрутку (≥3 правки сообщения) и PNG результата. Гарант срабатывает не позже 20-го Золотого сундука. `/chest info` выводит шансы, которые совпадают с конфигом.»', async () => {
    const g = await game();
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    giveReward(ctx, 'admin', 'u1', 'pearls', undefined, 10);
    const r = openChests(ctx, 'u1', 'wood', 1);
    expect(r.pearlsSpent).toBe(10);
    expect(getBalance(ctx, 'u1').pearls).toBeLessThan(10 + 1); // spent (challenge rewards may add a few back)
    expect(() => openChests(ctx, 'u1', 'gold', 1)).toThrow(ChestError);
    expect(BALANCE.chests.spinEdits).toBeGreaterThanOrEqual(3);
    const png = await renderChestCard({ chest: { name: r.chest.name, emoji: r.chest.emoji }, rewards: r.rewards.map((x) => ({ label: x.label, rarity: x.rarity, kind: x.kind })) });
    expect(isPng(png)).toBe(true);
    // pity: a legendary+ reward no later than the 20th gold chest, for many seeds
    expect(CHEST_BY_ID.gold.pity).toEqual({ opens: 20, minRarity: 'legendary' });
    for (let seed = 1; seed <= 15; seed++) {
      const gs = await game(seed);
      ensurePlayerReady(gs.ctx, 'p');
      giveReward(gs.ctx, 'admin', 'p', 'pearls', undefined, 80 * 20);
      let got = 0;
      for (let n = 1; n <= 20 && !got; n++) {
        const res = openChests(gs.ctx, 'p', 'gold', 1);
        if (res.rewards.some((x) => rarityAtLeast(x.rarity, 'legendary'))) got = n;
      }
      expect(got, `seed ${seed}`).toBeGreaterThan(0);
    }
    // /chest info odds = configured weights
    for (const c of CHESTS) {
      const total = c.loot.reduce((s, e) => s + e.weight, 0);
      const odds = chestOdds(c);
      expect(odds.map((o) => o.percent)).toEqual(c.loot.map((e) => (e.weight / total) * 100));
      expect(odds.reduce((s, o) => s + o.percent, 0)).toBeCloseTo(100);
      expect(c.price).toBe(BALANCE.chests.prices[c.id]);
    }
  });
  it.todo('«/chest open … показывает прокрутку (≥3 правки сообщения)» — the edit sequence itself requires live Discord');

  // AC10
  it('«Ежедневные испытания (3) и еженедельные (4) генерируются, отслеживают прогресс по игровым событиям и сбрасываются по расписанию в часовом поясе сервера. Награда выдаётся ровно один раз.»', async () => {
    // Monday 23:59:00 Moscow
    const g = await game(5, Date.UTC(2026, 0, 5, 20, 59, 0));
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    const monday = listChallenges(ctx, 'u1');
    expect(monday.filter((c) => c.scope === 'daily')).toHaveLength(3);
    expect(monday.filter((c) => c.scope === 'weekly')).toHaveLength(4);
    expect(monday.filter((c) => c.scope === 'seasonal').length).toBeGreaterThanOrEqual(10);
    // progress from real events: casts at the pond / catches
    const sp = regular('common', 'pond');
    for (let n = 0; n < 3; n++) cast(g, 'u1', fishRoll(sp, sp.minWeight), 'perfect', { location: 'pond' });
    const tracked = listChallenges(ctx, 'u1').filter((c) => ['catch', 'perfect', 'cast_at_location', 'new_species', 'total_weight'].includes(c.metric!));
    expect(tracked.length).toBeGreaterThan(0);
    for (const c of tracked) expect(c.progress, c.templateId).toBeGreaterThan(0);
    // reward exactly once
    const open = listChallenges(ctx, 'u1').find((c) => !c.completed && c.scope === 'seasonal' && !c.param)!;
    applyProgress(ctx, 'u1', open.metric!, open.target);
    const bal = getBalance(ctx, 'u1');
    const doneAt = listChallenges(ctx, 'u1').find((c) => c.id === open.id)!.completedAt;
    expect(doneAt).not.toBeNull();
    expect(applyProgress(ctx, 'u1', open.metric!, open.target * 2)).toEqual([]);
    expect(getBalance(ctx, 'u1')).toEqual(bal);
    expect(listChallenges(ctx, 'u1').find((c) => c.id === open.id)!.completedAt).toBe(doneAt);
    // 00:00 Moscow (21:00 UTC): new daily set, same weekly set; Monday 00:00 → new weekly set
    const p1 = currentPeriods(ctx);
    ctx.clock.set(Date.UTC(2026, 0, 5, 21, 0, 0));
    const p2 = currentPeriods(ctx);
    expect(p2.daily).not.toBe(p1.daily);
    expect(p2.weekly).toBe(p1.weekly);
    const tuesday = listChallenges(ctx, 'u1');
    expect(tuesday.filter((c) => c.scope === 'daily').every((c) => c.periodKey === '2026-01-06' && c.progress === 0)).toBe(true);
    ctx.clock.set(Date.UTC(2026, 0, 11, 21, 0, 0)); // Monday 12 Jan 00:00 Moscow
    const nextWeek = listChallenges(ctx, 'u1').filter((c) => c.scope === 'weekly');
    expect(nextWeek).toHaveLength(4);
    expect(nextWeek.every((c) => c.periodKey === weekKey(ctx.clock.now(), 'Europe/Moscow') && c.periodKey !== p1.weekly)).toBe(true);
  });

  // AC11
  it('«`/daily` выдаёт жемчуг с учётом серии дней. Пропуск дня сбрасывает серию.»', async () => {
    const g = await game();
    const { ctx } = g;
    const got: number[] = [];
    for (let d = 0; d < 9; d++) {
      const r = claimDaily(ctx, 'u1');
      if (!r.ok) throw new Error('claim failed');
      got.push(r.pearls);
      expect(claimDaily(ctx, 'u1')).toMatchObject({ ok: false, reason: 'already_claimed' });
      ctx.clock.advance(24 * HOUR);
    }
    expect(got).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 10]);
    ctx.clock.advance(24 * HOUR); // missed a day
    expect(claimDaily(ctx, 'u1')).toMatchObject({ ok: true, streak: 1, pearls: 3 });
  });

  // AC12
  it('«Сезон: пасс на 30 уровней с наградами. В конце сезона обнуляются сезонный рейтинг и пасс, но сохраняются снаряжение, валюты и коллекция. Топ-3 категорий получают постоянный титул.»', async () => {
    const g = await game();
    const { ctx } = g;
    await g.tick(); // season job creates season 1
    const s1 = getActiveSeason(ctx)!;
    expect(PASS_REWARDS.map((r) => r.level)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    for (const [n, uid] of ['a', 'b', 'c', 'd'].entries()) {
      cast(g, uid, fishRoll(regular('common', 'pond'), 3.5 - n), 'ok'); // a > b > c > d in every season category
      addPassXp(ctx, uid, (4 - n) * 1000);
    }
    addPassXp(ctx, 'a', 30 * BALANCE.pass.xpPerLevel);
    expect(getPassProgress(ctx, 'a')!.level).toBe(30);
    expect(hasCosmetic(ctx, 'a', 'title-season-master')).toBe(true);
    const snap = ['a', 'b', 'c', 'd'].map((u) => ({ u, bal: getBalance(ctx, u), gear: listGearItems(ctx, u).length, col: getCollectionPage(ctx, u, 'pond').caught }));
    const summary = adminEndSeason(ctx, 'admin');
    expect(summary.season.id).toBe(s1.id);
    const s2 = getActiveSeason(ctx)!;
    expect(s2.id).toBe(s1.id + 1);
    for (const x of snap) {
      expect(getBalance(ctx, x.u)).toEqual(x.bal);
      expect(listGearItems(ctx, x.u)).toHaveLength(x.gear);
      expect(getCollectionPage(ctx, x.u, 'pond').caught).toBe(x.col);
      expect(getPassProgress(ctx, x.u)!).toMatchObject({ seasonId: s2.id, level: 0, xp: 0 });
      expect(getLeaderboard(ctx, 'pass_level', { userId: x.u }).me).toBeNull();
    }
    // top-3 of the pass category (a, b, c) hold the permanent title; d does not
    for (const u of ['a', 'b', 'c']) expect(hasCosmetic(ctx, u, seasonTitleId(s1.id)), u).toBe(true);
    expect(hasCosmetic(ctx, 'd', seasonTitleId(s1.id))).toBe(false);
  });

  // AC13
  it('«Босс появляется по расписанию и по команде админа, получает урон от забросов в своей локации, `/boss` рисует PNG с полосой HP. При победе или по таймауту награды распределяются по тирам вклада.»', async () => {
    // Tuesday 2026-01-06 17:55 Moscow
    const g = await game(8, Date.UTC(2026, 0, 6, 14, 55, 0));
    const { ctx } = g;
    await g.tick();
    expect(getActiveBoss(ctx)).toBeUndefined();
    ctx.clock.set(Date.UTC(2026, 0, 6, 15, 0, 0)); // 18:00 Moscow
    await g.tick();
    const scheduled = getActiveBoss(ctx)!;
    expect(scheduled).toBeDefined();
    expect(scheduled.expires_at - scheduled.spawned_at).toBe(24 * HOUR);
    // the timeout pays participants the consolation tier
    for (const u of ['u1', 'u2']) addXp(ctx, u, 100_000);
    const loc = scheduled.location;
    const sp = regular('common', loc);
    cast(g, 'u1', fishRoll(sp, sp.minWeight), 'ok', { location: loc });
    const hpAfterHit = getBoss(ctx, scheduled.id)!.hp;
    expect(hpAfterHit).toBeLessThan(scheduled.max_hp);
    cast(g, 'u2', fishRoll(regular('common', 'pond'), 1), 'ok', { location: 'pond' });
    expect(getBoss(ctx, scheduled.id)!.hp).toBe(hpAfterHit); // other locations do no damage
    const png = await renderBossCard(buildBossCard(ctx, getBoss(ctx, scheduled.id)!));
    expect(isPng(png)).toBe(true);
    const before = getBalance(ctx, 'u1');
    ctx.clock.set(scheduled.expires_at + 60_000);
    await g.tick();
    expect(getBoss(ctx, scheduled.id)).toMatchObject({ status: 'expired', rewarded: 1 });
    expect(getBalance(ctx, 'u1').pearls - before.pearls).toBeGreaterThanOrEqual(BALANCE.boss.consolationPearls);
    // admin spawn → defeat → tiered rewards (big share → top tier, tiny share → lowest tier) + slayer title
    const boss = adminSpawnBoss(ctx, 'admin', 'lake-legend');
    const lake = regular('common', 'lake');
    cast(g, 'u2', fishRoll(lake, lake.minWeight), 'ok', { location: 'lake' });
    const b2 = getBalance(ctx, 'u2').pearls;
    const b1 = getBalance(ctx, 'u1').pearls;
    for (let n = 0; n < 300 && getBoss(ctx, boss.id)!.status === 'active'; n++) {
      ctx.clock.advance(20 * 60_000);
      cast(g, 'u1', fishRoll(lake, lake.maxWeight), 'perfect', { location: 'lake' });
      sellFish(ctx, 'u1', { kind: 'all' });
    }
    expect(getBoss(ctx, boss.id)).toMatchObject({ status: 'defeated', rewarded: 1 });
    expect(getBalance(ctx, 'u1').pearls - b1).toBeGreaterThanOrEqual(BALANCE.boss.rewardTiers[0]!.pearls);
    expect(getBalance(ctx, 'u2').pearls - b2).toBeGreaterThanOrEqual(BALANCE.boss.rewardTiers[2]!.pearls);
    expect(getBalance(ctx, 'u2').pearls - b2).toBeLessThan(BALANCE.boss.rewardTiers[1]!.pearls + 20);
    expect(hasCosmetic(ctx, 'u1', 'title-boss-slayer')).toBe(true);
    expect(() => endBoss(ctx)).toThrow();
  });

  // AC14
  it('«Недельная цель сервера отслеживается и при выполнении выдаёт награду всем активным игрокам.»', async () => {
    const g = await game();
    const { ctx } = g;
    const goal = ensureServerGoal(ctx);
    expect(goal).toMatchObject({ metric: 'total_weight', target: 5000, progress: 0 });
    ensurePlayerReady(ctx, 'idle'); // exists but no casts this week → not active
    cast(g, 'helper', fishRoll(regular('common', 'pond'), 1), 'ok');
    const big = { ...regular('common', 'pond') };
    const before = { helper: getBalance(ctx, 'helper'), idle: getBalance(ctx, 'idle') };
    cast(g, 'u1', fishRoll(big, 2600), 'ok');
    expect(getServerGoal(ctx, goal.week_key)!.progress).toBeCloseTo(2601);
    expect(getServerGoal(ctx, goal.week_key)!.completed_at).toBeNull();
    cast(g, 'u1', fishRoll(big, 2600), 'ok');
    const done = getServerGoal(ctx, goal.week_key)!;
    expect(done.completed_at).not.toBeNull();
    expect(done.rewarded).toBe(1);
    const r = BALANCE.serverGoal;
    expect(getBalance(ctx, 'helper').pearls - before.helper.pearls).toBe(r.rewardPearls);
    expect(getBalance(ctx, 'idle')).toEqual(before.idle);
    // more fish this week → no second reward
    const again = getBalance(ctx, 'helper');
    cast(g, 'u1', fishRoll(big, 2600), 'ok');
    expect(getBalance(ctx, 'helper')).toEqual(again);
  });

  // AC15
  it('«`/top` работает для всех 8 категорий (включая «Казино») и рисует PNG. Недельные категории сбрасываются в понедельник, победители объявляются в канале анонсов.»', async () => {
    const announced: AnnouncePayload[] = [];
    const g = await game(15);
    const { ctx } = g;
    ctx.announce = async (p) => void announced.push(p);
    for (const [n, u] of ['a', 'b', 'c'].entries()) {
      addXp(ctx, u, 1000 * (n + 1));
      cast(g, u, fishRoll(regular('rare', 'pond'), regular('rare', 'pond').minWeight + n), 'ok');
      sellFish(ctx, u, { kind: 'all' });
      addPassXp(ctx, u, 500 * (n + 1));
      giveReward(ctx, 'admin', u, 'coins', undefined, 500);
      const o = startCoins(ctx, u, 10, { deck: [card('A'), card('9'), card('K'), card('7'), card('5')] }); // player blackjack
      expect(o.finished).toBe(true);
    }
    expect(LEADERBOARD_CATEGORIES.map((c) => c.id)).toContain('casino_week');
    expect(LEADERBOARD_CATEGORIES).toHaveLength(8);
    for (const c of LEADERBOARD_CATEGORIES) {
      if (c.id === 'boss_damage_season') continue; // no boss fought in this test
      const board = getLeaderboard(ctx, c.id);
      expect(board.rows.length, c.id).toBeGreaterThan(0);
    }
    const casino = getLeaderboard(ctx, 'casino_week');
    const png = await renderLeaderboardCard({ title: casino.title, subtitle: casino.subtitle, rows: casino.rows.map((r) => ({ rank: r.rank, username: r.username, value: r.display })) });
    expect(isPng(png)).toBe(true);
    // Monday 00:00 → weekly job awards + announces the previous week's winners; new week boards are empty
    ctx.clock.set(Date.UTC(2026, 0, 11, 21, 1, 0));
    const pearls = getBalance(ctx, 'c').pearls;
    await g.tick();
    expect(getLeaderboard(ctx, 'casino_week').rows).toEqual([]);
    expect(getLeaderboard(ctx, 'heaviest_week').rows).toEqual([]);
    expect(getLeaderboard(ctx, 'level').rows.length).toBe(3); // all-time board not reset
    const weekly = announced.find((p) => p.title.includes('Итоги недели'));
    expect(weekly).toBeDefined();
    expect(weekly!.fields!.length).toBe(4);
    expect(getBalance(ctx, 'c').pearls).toBeGreaterThan(pearls);
    expect(runWeeklyReset(ctx)).toBeNull(); // idempotent
  });

  // AC16
  it('«`/profile` рисует PNG-карточку (аватар, уровень, энергия, экипировка, валюты, титул, ключевая статистика). `/stats` и `/server` показывают все поля из §11.»', async () => {
    const g = await game();
    const { ctx } = g;
    cast(g, 'u1', fishRoll(regular('uncommon', 'pond')), 'perfect');
    cast(g, 'u1', fishRoll(regular('common', 'pond')), 'late');
    claimDaily(ctx, 'u1');
    const files: { attachment: Buffer }[] = [];
    const i = {
      user: { id: 'u1', username: 'user-u1', bot: false, displayAvatarURL: () => '' },
      options: { getUser: () => null },
      deferReply: async () => undefined,
      editReply: async (p: { files?: { attachment: Buffer }[] }) => void files.push(...(p.files ?? [])),
      reply: async () => undefined,
    };
    await profileCommand.execute(i as never, ctx);
    expect(files).toHaveLength(1);
    expect(isPng(files[0]!.attachment)).toBe(true);
    const view = getPlayerStatsView(ctx, 'u1')!;
    for (const k of ['casts', 'catches', 'escapes', 'perfects', 'total_weight', 'heaviest_weight', 'catch_uncommon', 'daily_claims', 'pearls_earned']) {
      expect(view.stats[k], k).toBeGreaterThan(0);
    }
    expect(view.stats.pearls_earned).toBe(getBalance(ctx, 'u1').pearls); // every pearl so far was earned
    expect(view.perfectRate).toBe(1);
    expect(view.collection.caught).toBe(1);
    expect(view.personalRecords[0]).toMatchObject({ speciesId: regular('uncommon', 'pond').id });
    expect(view.byRarity).toHaveLength(6);
    expect(view.player.daily_streak).toBe(1);
    const server = getServerOverview(ctx);
    expect(server.totals).toMatchObject({ catches: 1, casts: 2 });
    expect(server.totals.totalWeight).toBeGreaterThan(0);
    expect(server.records[0]).toMatchObject({ userId: 'u1' });
    expect(server.goal.target).toBe(5000);
    expect(server.week.activePlayers).toBe(1);
    expect(server.rarest).toMatchObject({ userId: 'u1', rarity: 'uncommon' });
    expect(server.totals).toHaveProperty('bossesDefeated');
  });

  // AC17
  it('«`/collection` показывает пойманные и непойманные виды с пагинацией кнопками. Первая поимка вида даёт жемчуг и сохраняет рекорд веса.»', async () => {
    const g = await game();
    const { ctx } = g;
    const sp = regular('uncommon', 'pond');
    ensurePlayerReady(ctx, 'u1');
    const p0 = getBalance(ctx, 'u1').pearls;
    const first = cast(g, 'u1', fishRoll(sp, sp.minWeight), 'ok');
    expect(first).toMatchObject({ kind: 'caught', result: { firstOfSpecies: true, pearls: BALANCE.firstCatchPearls.uncommon, record: true } });
    expect(getBalance(ctx, 'u1').pearls - p0).toBeGreaterThanOrEqual(BALANCE.firstCatchPearls.uncommon);
    const second = cast(g, 'u1', fishRoll(sp, sp.maxWeight), 'ok');
    expect(second).toMatchObject({ kind: 'caught', result: { firstOfSpecies: false, pearls: 0, record: true } });
    const page = getCollectionPage(ctx, 'u1', 'pond');
    expect(page.caught).toBe(1);
    expect(page.total).toBeGreaterThan(1);
    expect(page.entries.filter((e) => e.caught === null).length).toBe(page.total - 1);
    const row = page.entries.find((e) => e.species.id === sp.id)!.caught!;
    expect(row).toMatchObject({ count: 2 });
    expect(row.best_weight).toBeGreaterThanOrEqual(sp.maxWeight);
    // one page per location (pagination)
    for (const l of LOCATIONS) expect(getCollectionPage(ctx, 'u1', l.id).location.id).toBe(l.id);
  });
  it.todo('«/collection … с пагинацией кнопками» — button navigation requires live Discord');

  // AC18
  it('«Эпическая+ поимка публикует анонс с PNG в канал анонсов.»', async () => {
    const g = await game();
    const { ctx } = g;
    const announced: AnnouncePayload[] = [];
    ctx.announce = async (p) => void announced.push(p);
    const epic = regular('epic');
    const step = cast(g, 'u1', fishRoll(epic, epic.minWeight), 'ok');
    if (step.kind !== 'caught') throw new Error(step.kind);
    expect(rarityAtLeast(step.result.species.rarity, 'epic')).toBe(true);
    await announceCatch(ctx, {
      userId: 'u1',
      card: { username: 'u1', species: { name: epic.name, rarity: epic.rarity, description: epic.description }, weight: step.result.weight, quality: step.result.quality, perfect: false, value: step.result.value, location: 'Пруд', firstOfSpecies: true },
    });
    expect(announced).toHaveLength(1);
    expect(announced[0]!.file!.name).toBe('catch.png');
    expect(isPng(announced[0]!.file!.data)).toBe(true);
  });
  it.todo('«Эпическая+ поимка публикует анонс…» — the /fish button flow posting to the real channel requires live Discord');

  // AC19
  it('«`/blackjack coins` и `/blackjack fish` работают. Жемчуг поставить нельзя. Ставки вне диапазона `[10, 100 + 50×уровень]` и 21-я раздача за сутки отклоняются.»', async () => {
    const g = await game();
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    giveReward(ctx, 'admin', 'u1', 'coins', undefined, 10_000);
    giveReward(ctx, 'admin', 'u1', 'pearls', undefined, 100);
    const max = 100 + 50 * getPlayer(ctx, 'u1')!.level;
    expect(() => startCoins(ctx, 'u1', 9)).toThrow(BlackjackError);
    expect(() => startCoins(ctx, 'u1', max + 1)).toThrow(BlackjackError);
    expect(() => (startFish as unknown as (...a: unknown[]) => unknown)(ctx, 'u1', [])).toThrow(BlackjackError);
    // pearls: no such stake type
    const { start } = await import('../../src/services/blackjack.js');
    expect(() => start(ctx, 'u1', { type: 'pearls', amount: 50 } as never)).toThrow(/Жемчуг ставить нельзя/);
    expect(getBalance(ctx, 'u1').pearls).toBe(100);
    // choices in the slash command: only coins & fish subcommands
    const bjJson = blackjackCommand.data.toJSON() as { options?: { name: string }[] };
    expect((bjJson.options ?? []).map((o) => o.name).sort()).toEqual(['coins', 'fish']);
    // fish stake works
    const sp = regular('uncommon', 'pond');
    cast(g, 'u1', fishRoll(sp, sp.maxWeight), 'ok');
    const f = listCaughtFish(ctx, 'u1')[0]!;
    const fo = startFish(ctx, 'u1', [f.id]);
    let o = fo;
    while (!o.finished) o = act(ctx, 'u1', o.hand.id, 'stand');
    // 20 hands a day, the 21st is refused
    let played = 1;
    while (played < BALANCE.blackjack.handsPerDay) {
      let h = startCoins(ctx, 'u1', 10);
      played++;
      while (!h.finished) h = act(ctx, 'u1', h.hand.id, 'stand');
    }
    expect(() => startCoins(ctx, 'u1', 10)).toThrow(/Лимит/);
    ctx.clock.advance(24 * HOUR); // resets with the daily challenges
    expect(startCoins(ctx, 'u1', 10).hand.userId).toBe('u1');
  });

  // AC20
  it('«Логика блэкджека покрыта юнит-тестами с seeded RNG: подсчёт тузов (1/11), soft 17 у дилера, выплата 3:2, удвоение, ничья с возвратом рыбы в садок, перебор.»', async () => {
    const g = await game();
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    giveReward(ctx, 'admin', 'u1', 'coins', undefined, 10_000);
    expect(handValue([card('A'), card('A'), card('9')])).toEqual({ total: 21, soft: true });
    expect(handValue([card('A'), card('K'), card('5')])).toEqual({ total: 16, soft: false });
    const coins = (): number => getBalance(ctx, 'u1').coins;
    // 3:2 on a natural
    let c0 = coins();
    let o = startCoins(ctx, 'u1', 100, { deck: [card('A'), card('9'), card('K'), card('7')] });
    expect(o.hand.state.result).toBe('blackjack');
    expect(coins() - c0).toBe(150);
    // dealer stands on soft 17 (A+6): player 18 wins
    c0 = coins();
    o = startCoins(ctx, 'u1', 100, { deck: [card('K'), card('A'), card('8'), card('6'), card('5')] });
    o = act(ctx, 'u1', o.hand.id, 'stand');
    expect(o.hand.state.dealer).toHaveLength(2);
    expect(o.hand.state.result).toBe('win');
    expect(coins() - c0).toBe(100);
    // double: one card, stake ×2
    c0 = coins();
    o = startCoins(ctx, 'u1', 100, { deck: [card('6'), card('K'), card('5'), card('7'), card('K')] });
    o = act(ctx, 'u1', o.hand.id, 'double');
    expect(o.hand.state).toMatchObject({ doubled: true, result: 'win' });
    expect(coins() - c0).toBe(200);
    // bust
    c0 = coins();
    o = startCoins(ctx, 'u1', 100, { deck: [card('K'), card('9'), card('6'), card('8'), card('Q')] });
    o = act(ctx, 'u1', o.hand.id, 'hit');
    expect(o.hand.state.result).toBe('bust');
    expect(coins() - c0).toBe(-100);
    // push with a fish stake → the fish goes back to the cage
    const sp = regular('uncommon', 'pond');
    cast(g, 'u1', fishRoll(sp, sp.maxWeight), 'ok');
    const f = listCaughtFish(ctx, 'u1')[0]!;
    o = startFish(ctx, 'u1', [f.id], { deck: [card('K'), card('Q'), card('K'), card('Q')] });
    expect(listCaughtFish(ctx, 'u1')).toHaveLength(0); // staked = out of the cage
    o = act(ctx, 'u1', o.hand.id, 'stand');
    expect(o.hand.state.result).toBe('push');
    expect(listCaughtFish(ctx, 'u1').map((x) => x.id)).toEqual([f.id]);
  });

  // AC21
  it('«Чужой пользователь не может нажимать кнопки раздачи. Через 60 с срабатывает авто-«Хватит». Незавершённая раздача корректно закрывается после рестарта бота.»', async () => {
    const g = await game();
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    giveReward(ctx, 'admin', 'u1', 'coins', undefined, 1000);
    const o = startCoins(ctx, 'u1', 50, { deck: [card('K'), card('9'), card('8'), card('8'), card('5'), card('5')] });
    const action = bjComponents.find((c) => c.prefix === 'bj')!;
    const { i, replies } = fakeComponent('intruder');
    await action.handle(i, ['s', String(o.hand.id)], ctx);
    expect(replies).toEqual([NOT_OWNER_TEXT]);
    expect(getHand(ctx, o.hand.id)!.status).toBe('active');
    // 60 s idle → the minute job auto-stands it
    ctx.clock.advance(BALANCE.blackjack.timeoutMs + 1);
    await g.tick();
    expect(getHand(ctx, o.hand.id)).toMatchObject({ status: 'finished', state: { result: 'win' } });
    // restart: a hand left active in the DB is settled by the first scheduler tick of a fresh process
    const o2 = startCoins(ctx, 'u1', 50, { deck: [card('K'), card('9'), card('8'), card('8'), card('5'), card('5')] });
    const coins = getBalance(ctx, 'u1').coins;
    ctx.clock.advance(10 * 60_000); // bot was down
    const rebooted = createContext({ db: ctx.db, clock: ctx.clock, rng: seededRng(1), defaultTimezone: 'Europe/Moscow' });
    await runDueJobs(rebooted, await loadJobs(), new Map());
    expect(getHand(ctx, o2.hand.id)).toMatchObject({ status: 'finished', payout: 100 });
    expect(getActiveHand(ctx, 'u1')).toBeUndefined();
    expect(getBalance(ctx, 'u1').coins).toBe(coins + 100);
  });
  it.todo('«Через 60 с срабатывает авто-«Хватит»» — the in-memory message timer that edits the table requires live Discord');

  // AC22
  it('«`/admin` доступен только с правом Manage Guild и покрывает все подкоманды из §13.»', async () => {
    const json = adminCommand.data.toJSON() as { default_member_permissions?: string | null; options?: { name: string; options?: { name: string }[] }[] };
    expect(json.default_member_permissions).toBe(PermissionFlagsBits.ManageGuild.toString());
    const sub = (name: string): string[] => (json.options ?? []).find((o) => o.name === name)?.options?.map((o) => o.name).sort() ?? [];
    expect(sub('config')).toEqual(expect.arrayContaining(['channel', 'timezone']));
    expect(sub('boss')).toEqual(['end', 'spawn']);
    expect(sub('event')).toEqual(['start']);
    expect(sub('season')).toEqual(['end', 'start']);
    expect((json.options ?? []).map((o) => o.name)).toEqual(expect.arrayContaining(['give', 'reset-user']));
    // runtime check: without the permission nothing runs
    const g = await game();
    const replies: string[] = [];
    const i = {
      memberPermissions: { has: () => false },
      replied: false,
      deferred: false,
      reply: async (p: { content: string }) => void replies.push(p.content),
      options: { getSubcommandGroup: () => 'boss', getSubcommand: () => 'spawn' },
    };
    await adminCommand.execute(i as never, g.ctx);
    expect(replies).toEqual(['Нужно право Manage Guild.']);
    expect(getActiveBoss(g.ctx)).toBeUndefined();
  });

  // AC23
  it('«В data-файлах ≥ 50 видов рыб, 5 локаций, полный набор снаряжения по 5 слотам и 6 тирам, 3 сундука с таблицами дропа, пул из ≥ 15 ежедневных и ≥ 10 еженедельных шаблонов испытаний.»', () => {
    expect(FISH.filter((f) => !f.seasonTheme).length).toBeGreaterThanOrEqual(50);
    expect(LOCATIONS).toHaveLength(5);
    for (const slot of GEAR_SLOTS) for (const tier of RARITIES) expect(GEAR.some((g) => g.slot === slot && g.tier === tier), `${slot}/${tier}`).toBe(true);
    expect(CONSUMABLES.filter((c) => c.kind === 'bait').length).toBeGreaterThanOrEqual(5); // 5th slot: bait (consumable)
    expect(CHESTS.map((c) => c.id).sort()).toEqual(['gold', 'silver', 'wood']);
    for (const c of CHESTS) expect(c.loot.length).toBeGreaterThan(0);
    expect(CHALLENGE_TEMPLATES.filter((t) => t.scope === 'daily').length).toBeGreaterThanOrEqual(15);
    expect(CHALLENGE_TEMPLATES.filter((t) => t.scope === 'weekly').length).toBeGreaterThanOrEqual(10);
  });

  // AC24
  it('«Все изменения валют и инвентаря идут через транзакции. Одновременные `/sell` и `/chest open` не дают уйти в минус (есть тест).»', async () => {
    // full randomized version: tests/integration/concurrency.test.ts
    const g = await game();
    const { ctx } = g;
    ensurePlayerReady(ctx, 'u1');
    giveReward(ctx, 'admin', 'u1', 'pearls', undefined, 15);
    cast(g, 'u1', fishRoll(regular('common', 'pond')), 'ok');
    const results = await Promise.allSettled([
      Promise.resolve().then(() => openChests(ctx, 'u1', 'wood', 1)),
      Promise.resolve().then(() => sellFish(ctx, 'u1', { kind: 'all' })),
      Promise.resolve().then(() => openChests(ctx, 'u1', 'wood', 1)),
      Promise.resolve().then(() => sellFish(ctx, 'u1', { kind: 'all' })),
      Promise.resolve().then(() => takeCurrency(ctx, 'admin', 'u1', 'pearls', 1000)),
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1); // the second chest
    expect(getBalance(ctx, 'u1')).toEqual({ coins: getBalance(ctx, 'u1').coins, pearls: 0 });
    expect(getBalance(ctx, 'u1').coins).toBeGreaterThanOrEqual(0);
    // a failing grant inside a transaction rolls back everything (no partial spend)
    const before = getBalance(ctx, 'u1');
    expect(() => giveReward(ctx, 'admin', 'u1', 'gear', 'no-such-gear', 1)).toThrow();
    expect(getBalance(ctx, 'u1')).toEqual(before);
    // DB-level guard: balances can never be negative even outside the services
    expect(() => prepare(ctx.db, "UPDATE players SET coins = -1 WHERE user_id = 'u1'").run()).toThrow(/CHECK/);
  });
});
