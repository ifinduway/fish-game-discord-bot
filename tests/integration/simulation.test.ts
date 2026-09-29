// Integration QA (plan "Integration & QA" step 2): 8 simulated players × 14 days, driven only through services, with the
// real subscribers and scheduler jobs, a fake clock and seeded rng. Invariants are asserted after every simulated day,
// then the season is forced to roll over. A short economy summary is printed for balance sanity-checking.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { Notice } from '../../src/core/events.js';
import { seededRng, type Rng } from '../../src/core/rng.js';
import { dayKey } from '../../src/core/time.js';
import { GEAR_BY_ID } from '../../src/data/gear.js';
import { LOCATIONS } from '../../src/data/locations.js';
import { GEAR_SLOTS, rarityIndex, type ChestId, type LocationId } from '../../src/data/types.js';
import { prepare } from '../../src/db/database.js';
import { countCaughtFish, getConsumableQty, listCaughtFish, listCosmetics } from '../../src/db/repos/inventory.js';
import { getPlayer } from '../../src/db/repos/players.js';
import { getAllServerStats } from '../../src/db/repos/server-stats.js';
import * as stats from '../../src/db/repos/stats.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { handValue, maxBet } from '../../src/game/blackjack.js';
import { act, BlackjackError, getActiveHand, listStakeableFish, startCoins, startFish, type BjOutcome } from '../../src/services/blackjack.js';
import { getActiveBoss } from '../../src/services/boss.js';
import { ChestError, openChests } from '../../src/services/chest.js';
import { claimDaily, sellFish, useItem } from '../../src/services/economy.js';
import { ensurePlayerReady, getPlayerState } from '../../src/services/player-state.js';
import { getActiveSeason, getPassProgress, rolloverIfDue, seasonTitleId } from '../../src/services/season.js';
import { buy, equipGear, listOwnedGear, upgradeGear, upgradeInfo } from '../../src/services/shop.js';
import { createGame, playCast, resetGlobals, type Game } from './_harness.js';
import { ledger } from './_ledger.js';

// ───────────── reward ledger: pass-through spy on grantReward (every non-fishing pearl source goes through it) ─────────────
vi.mock('../../src/services/rewards.js', async (importOriginal) =>
  (await import('./_ledger.js')).wrapRewards(await importOriginal<typeof import('../../src/services/rewards.js')>()),
);

afterAll(() => resetGlobals());

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TICK = 5 * 60_000;
/** Monday 2026-01-05 00:00 Europe/Moscow */
const START = Date.UTC(2026, 0, 4, 21, 0, 0);
const DAYS = 14;

interface Profile {
  id: string;
  /** local session hours (3–5 per day) */
  hours: number[];
  reaction: [number, number];
  reelAccuracy: number;
  chest: ChestId;
  bjHandsPerSession: number;
  fishStake: boolean;
  skipDailyChance: number;
}

const PROFILES: Profile[] = [
  { id: 'p1', hours: [7, 11, 15, 19, 23], reaction: [150, 700], reelAccuracy: 0.95, chest: 'gold', bjHandsPerSession: 0, fishStake: false, skipDailyChance: 0 },
  { id: 'p2', hours: [8, 13, 18, 22], reaction: [200, 1200], reelAccuracy: 0.85, chest: 'silver', bjHandsPerSession: 2, fishStake: true, skipDailyChance: 0.05 },
  { id: 'p3', hours: [9, 14, 20], reaction: [300, 1800], reelAccuracy: 0.75, chest: 'wood', bjHandsPerSession: 1, fishStake: false, skipDailyChance: 0.1 },
  { id: 'p4', hours: [7, 12, 17, 21], reaction: [150, 900], reelAccuracy: 0.9, chest: 'gold', bjHandsPerSession: 3, fishStake: true, skipDailyChance: 0 },
  { id: 'p5', hours: [10, 16, 22], reaction: [400, 2500], reelAccuracy: 0.6, chest: 'wood', bjHandsPerSession: 0, fishStake: false, skipDailyChance: 0.2 },
  { id: 'p6', hours: [6, 10, 14, 18, 22], reaction: [150, 600], reelAccuracy: 0.97, chest: 'silver', bjHandsPerSession: 1, fishStake: false, skipDailyChance: 0 },
  { id: 'p7', hours: [8, 12, 19], reaction: [250, 1500], reelAccuracy: 0.8, chest: 'gold', bjHandsPerSession: 4, fishStake: true, skipDailyChance: 0.05 },
  { id: 'p8', hours: [9, 13, 17, 21], reaction: [200, 1100], reelAccuracy: 0.88, chest: 'silver', bjHandsPerSession: 1, fishStake: false, skipDailyChance: 0.1 },
];

type PearlSource =
  | 'daily_login'
  | 'first_catch'
  | 'treasure'
  | 'challenge_daily'
  | 'challenge_bonus'
  | 'challenge_weekly'
  | 'challenge_seasonal'
  | 'pass'
  | 'achievement'
  | 'boss'
  | 'server_goal'
  | 'weekly_top'
  | 'tournament'
  | 'other';

function ledgerCategory(source: string): PearlSource {
  if (source === 'challenge:daily_bonus') return 'challenge_bonus';
  if (source.startsWith('challenge:daily:')) return 'challenge_daily';
  if (source.startsWith('challenge:weekly:')) return 'challenge_weekly';
  if (source.startsWith('challenge:seasonal:')) return 'challenge_seasonal';
  for (const p of ['pass', 'achievement', 'boss', 'server_goal', 'weekly_top', 'tournament'] as const) if (source.startsWith(`${p}:`)) return p;
  return 'other';
}

interface Tally {
  casts: number;
  catches: number;
  escapes: number;
  junk: number;
  treasures: number;
  /** pearls credited outside grantReward (fishing service / daily) */
  directPearls: Record<'daily_login' | 'first_catch' | 'treasure', number>;
  pearlsSpent: number;
  chests: number;
  coinsSold: number;
  coinsJunkTreasure: number;
  bjNet: number;
  bjHands: number;
  passLevel: number;
  dailySkips: number;
}

const newTally = (): Tally => ({
  casts: 0,
  catches: 0,
  escapes: 0,
  junk: 0,
  treasures: 0,
  directPearls: { daily_login: 0, first_catch: 0, treasure: 0 },
  pearlsSpent: 0,
  chests: 0,
  coinsSold: 0,
  coinsJunkTreasure: 0,
  bjNet: 0,
  bjHands: 0,
  passLevel: 0,
  dailySkips: 0,
});

describe('integration: 8 players × 14 days', () => {
  it('keeps every cross-package invariant and rolls the season over without touching permanent progress', async () => {
    ledger.length = 0;
    resetGlobals();
    const log = console.log.bind(console);
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].startsWith('[blackjack]')) return; // job chatter
      log(...args);
    });
    const game: Game = await createGame({ seed: 20260105, now: START });
    const { ctx } = game;
    expect(game.subscribers.length).toBe(7);
    expect(game.jobs.map((j) => j.name).sort()).toEqual(['blackjack-expire', 'boss', 'season', 'server-events', 'weekly']);

    const sim: Rng = seededRng(777);
    const tallies = new Map<string, Tally>(PROFILES.map((p) => [p.id, newTally()]));
    const challengeEvents = new Map<string, number>();
    const bossFinished = new Map<number, number>();
    const passLevels = new Map<string, number>();
    ctx.bus.on('challenge_completed', (e) => void challengeEvents.set(e.userId, (challengeEvents.get(e.userId) ?? 0) + 1));
    ctx.bus.on('boss_finished', (e) => void bossFinished.set(e.bossId, (bossFinished.get(e.bossId) ?? 0) + 1));
    const noticeCount = { n: 0 };
    const eat = (n: Notice[]): void => void (noticeCount.n += n.length);

    // ───────────── schedule: per player per day, 3–5 sessions with ±40 min jitter ─────────────
    const sessions: { at: number; profile: Profile; firstOfDay: boolean }[] = [];
    for (let d = 0; d < DAYS; d++) {
      for (const p of PROFILES) {
        const hours = p.hours.filter(() => sim.chance(0.9));
        if (hours.length < 3) hours.splice(0, hours.length, ...p.hours.slice(0, 3));
        hours.forEach((h, i) => {
          const at = START + d * DAY + h * HOUR + sim.int(-40, 40) * 60_000;
          sessions.push({ at: Math.max(START + d * DAY, at), profile: p, firstOfDay: i === 0 });
        });
      }
    }
    sessions.sort((a, b) => a.at - b.at);

    // ───────────── player behaviour ─────────────
    const unlocked = (uid: string): LocationId[] => {
      const level = getPlayer(ctx, uid)!.level;
      return LOCATIONS.filter((l) => l.unlockLevel <= level).map((l) => l.id);
    };
    const chooseLocation = (uid: string): LocationId => {
      const locs = unlocked(uid);
      const boss = getActiveBoss(ctx);
      if (boss && locs.includes(boss.location as LocationId) && boss.expires_at > ctx.clock.now()) return boss.location as LocationId;
      if (locs.length > 1 && sim.chance(0.3)) return locs[locs.length - 2]!;
      return locs[locs.length - 1]!;
    };

    const equipBest = (uid: string): void => {
      const owned = listOwnedGear(ctx, uid);
      for (const slot of GEAR_SLOTS) {
        const inSlot = owned.filter((g) => g.def.slot === slot);
        inSlot.sort((a, b) => rarityIndex(b.def.tier) - rarityIndex(a.def.tier) || b.item.upgrade - a.item.upgrade);
        const best = inSlot[0];
        if (best && !best.equipped) expect(equipGear(ctx, uid, best.item.id).ok).toBe(true);
      }
    };

    const manage = (p: Profile): void => {
      const uid = p.id;
      const level = getPlayer(ctx, uid)!.level;
      // gear from the shop (next tiers), then equip the best owned piece per slot
      for (const tier of ['uncommon', 'rare'] as const) {
        for (const slot of GEAR_SLOTS) {
          const id = `${slot}-${tier}`;
          const def = GEAR_BY_ID[id];
          if (!def || level < def.unlockLevel) continue;
          if (listOwnedGear(ctx, uid).some((g) => g.def.id === id)) continue;
          const coins = getBalance(ctx, uid).coins;
          if ((def.shopPrice ?? Infinity) <= coins * 0.6) {
            const r = buy(ctx, uid, id);
            if (r.ok) eat(r.notices);
          }
        }
      }
      equipBest(uid);
      // upgrades: rod first, then the rest, only with a comfortable buffer
      for (const slot of ['rod', 'outfit', 'reel', 'line'] as const) {
        const info = upgradeInfo(ctx, uid, slot);
        if (info?.cost != null && getBalance(ctx, uid).coins > info.cost * 3) {
          const r = upgradeGear(ctx, uid, slot);
          expect(r.ok).toBe(true);
          if (r.ok) eat(r.notices);
        }
      }
      // cage expansion when the cage gets crowded
      const cap = getPlayer(ctx, uid)!.cage_capacity;
      if (cap < 100 && countCaughtFish(ctx, uid, true) >= cap - 15) {
        const r = buy(ctx, uid, 'cage-upgrade');
        if (r.ok) eat(r.notices);
      }
      // energy drinks for the hardcore players, bait for everybody sometimes
      if (p.hours.length >= 5 && getConsumableQty(ctx, uid, 'energy-drink') === 0 && getBalance(ctx, uid).coins > 1500) {
        const r = buy(ctx, uid, 'energy-drink', 2);
        if (r.ok) eat(r.notices);
      }
      if (sim.chance(0.15) && getBalance(ctx, uid).coins > 600) {
        const r = buy(ctx, uid, 'bait-worm');
        if (r.ok) {
          eat(r.notices);
          expect(useItem(ctx, uid, 'bait-worm').ok).toBe(true);
        }
      }
    };

    const playHand = (p: Profile, t: Tally): void => {
      const uid = p.id;
      const level = getPlayer(ctx, uid)!.level;
      let o: BjOutcome;
      try {
        if (p.fishStake && sim.chance(0.35)) {
          const fish = listStakeableFish(ctx, uid).sort((a, b) => a.value - b.value);
          const picked: number[] = [];
          let sum = 0;
          for (const f of fish) {
            if (sum + f.value > maxBet(level)) break;
            picked.push(f.id);
            sum += f.value;
            if (sum >= 10 && picked.length >= sim.int(1, 3)) break;
          }
          if (sum < BALANCE.blackjack.minBet) return;
          o = startFish(ctx, uid, picked);
        } else {
          const coins = getBalance(ctx, uid).coins;
          const bet = Math.min(maxBet(level), Math.max(BALANCE.blackjack.minBet, Math.floor(coins * 0.05)));
          if (coins < bet) return;
          o = startCoins(ctx, uid, bet);
        }
      } catch (err) {
        if (err instanceof BlackjackError) return; // daily limit / active hand / funds — rejected cleanly
        throw err;
      }
      t.bjHands++;
      eat(o.notices);
      // 5% of hands are abandoned (the 60 s timeout job settles them)
      if (!o.finished && sim.chance(0.05)) return;
      while (!o.finished) {
        const v = handValue(o.hand.state.player).total;
        const action = o.canDouble && v >= 10 && v <= 11 && sim.chance(0.6) ? 'double' : v < 17 ? 'hit' : 'stand';
        ctx.clock.advance(sim.int(1000, 8000));
        o = act(ctx, uid, o.hand.id, action);
        eat(o.notices);
      }
      t.bjNet += o.net;
    };

    const openChestsFor = (p: Profile, t: Tally): void => {
      const uid = p.id;
      for (;;) {
        const pearls = getBalance(ctx, uid).pearls;
        const price = BALANCE.chests.prices[p.chest];
        if (pearls < price) return;
        const count = Math.min(BALANCE.chests.maxOpenCount, Math.floor(pearls / price));
        const before = getBalance(ctx, uid).pearls;
        const ledgerMark = ledger.length;
        let r;
        try {
          r = openChests(ctx, uid, p.chest, count);
        } catch (err) {
          if (err instanceof ChestError) return;
          throw err;
        }
        // spent exactly price × count (pearls earned meanwhile come from challenge/achievement rewards triggered by chest_opened)
        const earnedMeanwhile = ledger.slice(ledgerMark).filter((l) => l.userId === uid).reduce((s, l) => s + l.pearls, 0);
        expect(before + earnedMeanwhile - getBalance(ctx, uid).pearls).toBe(r.pearlsSpent);
        expect(r.pearlsSpent).toBe(price * count);
        t.pearlsSpent += r.pearlsSpent;
        t.chests += r.count;
        eat(r.notices);
        equipBest(uid);
      }
    };

    const playSession = (p: Profile, firstOfDay: boolean): void => {
      const uid = p.id;
      const t = tallies.get(uid)!;
      ensurePlayerReady(ctx, uid, `user-${uid}`); // what every command does first
      if (firstOfDay) {
        if (sim.chance(p.skipDailyChance)) t.dailySkips++;
        else {
          const r = claimDaily(ctx, uid, `user-${uid}`);
          if (r.ok) {
            t.directPearls.daily_login += r.pearls;
            eat(r.notices);
          }
        }
      }
      manage(p);
      for (let casts = 0; casts < 16; ) {
        const reactionMs = sim.int(p.reaction[0], p.reaction[1]);
        const out = playCast(ctx, uid, { reactionMs, reelAccuracy: p.reelAccuracy, rng: sim, location: chooseLocation(uid) });
        if (!out.ok) {
          const code = out.error.code;
          if (code === 'cage_full') {
            const s = sellFish(ctx, uid, { kind: 'all' });
            if (s.count === 0) break; // only staked fish left
            t.coinsSold += s.coins;
            eat(s.notices);
            continue;
          }
          if (code === 'no_energy') {
            if (getConsumableQty(ctx, uid, 'energy-drink') > 0 && useItem(ctx, uid, 'energy-drink').ok) continue;
            break;
          }
          throw new Error(`unexpected cast error for ${uid}: ${code}`);
        }
        casts++;
        t.casts++;
        const step = out.step;
        eat(step.notices);
        if (step.kind === 'caught') {
          t.catches++;
          t.directPearls.first_catch += step.result.pearls;
          // cage invariant right after every catch
          expect(countCaughtFish(ctx, uid)).toBeLessThanOrEqual(getPlayer(ctx, uid)!.cage_capacity);
        } else if (step.kind === 'escaped') t.escapes++;
        else if (step.kind === 'junk') {
          t.junk++;
          t.coinsJunkTreasure += step.coins;
        } else if (step.kind === 'treasure') {
          t.treasures++;
          t.coinsJunkTreasure += step.coins;
          t.directPearls.treasure += step.pearls;
        }
        ctx.clock.advance(sim.int(1500, 4000));
      }
      // blackjack with some of the catch, then sell the rest
      for (let h = 0; h < p.bjHandsPerSession; h++) playHand(p, t);
      const s = sellFish(ctx, uid, { kind: 'all' });
      t.coinsSold += s.coins;
      eat(s.notices);
      openChestsFor(p, t);
    };

    // ───────────── invariants ─────────────
    let seasonId = getActiveSeason(ctx)?.id ?? null;
    const checkInvariants = (label: string): void => {
      const all = PROFILES.map((p) => p.id);
      let sumCatches = 0;
      let sumCasts = 0;
      for (const uid of all) {
        const t = tallies.get(uid)!;
        const p = getPlayer(ctx, uid);
        if (!p) continue;
        // currencies & energy
        expect(p.coins, `${label} ${uid} coins`).toBeGreaterThanOrEqual(0);
        expect(p.pearls, `${label} ${uid} pearls`).toBeGreaterThanOrEqual(0);
        expect(p.energy, `${label} ${uid} stored energy`).toBeGreaterThanOrEqual(0);
        const st = getPlayerState(ctx, uid);
        expect(st.energy).toBeGreaterThanOrEqual(0);
        expect(st.energy, `${label} ${uid} energy cap`).toBeLessThanOrEqual(st.maxEnergy * BALANCE.energy.overflowCapFactor + 1e-6);
        // cage: unstaked fish never exceed capacity by more than fish returned from a blackjack push
        expect(countCaughtFish(ctx, uid, true)).toBeLessThanOrEqual(p.cage_capacity + BALANCE.blackjack.maxFishOptions);
        // stats counters == actions performed; per-player casts/catches match the simulation tallies
        expect(stats.get(ctx, uid, 'casts'), `${label} ${uid} casts`).toBe(t.casts);
        expect(stats.get(ctx, uid, 'catches'), `${label} ${uid} catches`).toBe(t.catches);
        expect(stats.get(ctx, uid, 'escapes')).toBe(t.escapes);
        expect(stats.get(ctx, uid, 'junk')).toBe(t.junk);
        expect(stats.get(ctx, uid, 'chests_opened')).toBe(t.chests);
        sumCatches += t.catches;
        sumCasts += t.casts;
        // challenges: completed at most once, progress within target, one event + one reward per completion
        const rows = prepare(ctx.db, 'SELECT progress, target, completed_at FROM challenges WHERE user_id = ?').all(uid) as {
          progress: number;
          target: number;
          completed_at: number | null;
        }[];
        for (const r of rows) {
          expect(r.progress).toBeLessThanOrEqual(r.target);
          if (r.completed_at !== null) expect(r.progress).toBe(r.target);
        }
        const completed = rows.filter((r) => r.completed_at !== null).length;
        expect(challengeEvents.get(uid) ?? 0, `${label} ${uid} challenge events`).toBe(completed);
        const mine = ledger.filter((l) => l.userId === uid);
        expect(mine.filter((l) => /^challenge:(daily|weekly|seasonal):/.test(l.source)).length).toBe(completed);
        const bonuses = (prepare(ctx.db, 'SELECT COUNT(*) AS n FROM challenge_bonuses WHERE user_id = ?').get(uid) as { n: number }).n;
        expect(mine.filter((l) => l.source === 'challenge:daily_bonus').length).toBe(bonuses);
        // one-shot reward sources are never granted twice
        const once = mine.filter((l) => /^(pass|achievement|boss|server_goal|weekly_top|tournament):/.test(l.source)).map((l) => l.source);
        expect(new Set(once).size, `${label} ${uid} duplicate one-shot rewards`).toBe(once.length);
        // pearls ledger: every pearl is explained by a source; chests are the only sink
        const ledgerPearls = mine.reduce((s, l) => s + l.pearls, 0);
        const direct = t.directPearls.daily_login + t.directPearls.first_catch + t.directPearls.treasure;
        expect(p.pearls, `${label} ${uid} pearls ledger`).toBe(ledgerPearls + direct - t.pearlsSpent);
        // /stats «Жемчуга получено» counts every source, not just treasure
        expect(stats.get(ctx, uid, 'pearls_earned'), `${label} ${uid} pearls_earned stat`).toBe(ledgerPearls + direct);
        // staked fish belong to an active hand and vice versa
        const staked = listCaughtFish(ctx, uid, { includeStaked: true }).filter((f) => f.staked === 1).map((f) => f.id).sort((a, b) => a - b);
        const hand = getActiveHand(ctx, uid);
        const handFish = hand && hand.stakeType === 'fish' ? [...hand.stakedFish].sort((a, b) => a - b) : [];
        expect(staked, `${label} ${uid} staked fish`).toEqual(handFish);
        // pass level never decreases within a season
        const sid = getActiveSeason(ctx)!.id;
        const lvl = getPassProgress(ctx, uid, sid)?.level ?? 0;
        const key = `${uid}:${sid}`;
        expect(lvl).toBeGreaterThanOrEqual(passLevels.get(key) ?? 0);
        passLevels.set(key, lvl);
        t.passLevel = lvl;
      }
      const server = getAllServerStats(ctx, 'all');
      expect(server.catches ?? 0, `${label} server catches`).toBe(sumCatches);
      expect(server.casts ?? 0, `${label} server casts`).toBe(sumCasts);
      // bosses: every finished boss rewarded exactly once, one boss_finished event each
      const bosses = prepare(ctx.db, 'SELECT id, status, rewarded FROM bosses').all() as { id: number; status: string; rewarded: number }[];
      for (const b of bosses) {
        if (b.status === 'active') expect(b.rewarded).toBe(0);
        else {
          expect(b.rewarded, `boss ${b.id} rewarded`).toBe(1);
          expect(bossFinished.get(b.id), `boss ${b.id} finished events`).toBe(1);
        }
      }
      expect(prepare(ctx.db, "SELECT COUNT(*) AS n FROM seasons WHERE status = 'active'").get()).toEqual({ n: 1 });
      if (seasonId === null) seasonId = getActiveSeason(ctx)!.id;
    };

    // ───────────── main loop: 5-minute scheduler ticks, sessions in time order ─────────────
    const END = START + DAYS * DAY + 2 * HOUR; // past the second Monday reset
    let next = 0;
    let dayChecked = 0;
    for (let t = START; t <= END; t += TICK) {
      if (ctx.clock.now() < t) ctx.clock.set(t);
      await game.tick();
      while (next < sessions.length && sessions[next]!.at <= t) {
        const s = sessions[next++]!;
        playSession(s.profile, s.firstOfDay);
        await game.tick(); // blackjack-expire / boss expiry catch up
      }
      const day = Math.floor((ctx.clock.now() - START) / DAY);
      if (day > dayChecked) {
        checkInvariants(`day ${day} (${dayKey(ctx.clock.now(), ctx.config.timezone)})`);
        dayChecked = day;
      }
    }
    // settle anything left open, then final check
    ctx.clock.advance(10 * 60_000);
    await game.tick();
    checkInvariants('end of day 14');
    expect(prepare(ctx.db, "SELECT COUNT(*) AS n FROM blackjack_hands WHERE status = 'active'").get()).toEqual({ n: 0 });
    expect(dayChecked).toBeGreaterThanOrEqual(DAYS);
    // the simulation really exercised the cross-package features
    expect((prepare(ctx.db, 'SELECT COUNT(*) AS n FROM bosses').get() as { n: number }).n).toBeGreaterThanOrEqual(3);
    // first tick settles the (empty) week before START, then the two Monday resets inside the simulation
    expect(prepare(ctx.db, "SELECT COUNT(*) AS n FROM periodic_runs WHERE job = 'weekly'").get()).toEqual({ n: 3 });
    expect(ledger.some((l) => l.source.startsWith('weekly_top:'))).toBe(true);
    expect(ledger.some((l) => l.source.startsWith('challenge:weekly:'))).toBe(true);
    expect(ledger.some((l) => l.source.startsWith('pass:'))).toBe(true);

    // ───────────── economy summary ─────────────
    const earnedBySource = new Map<PearlSource, number>();
    const addSrc = (k: PearlSource, v: number): void => void earnedBySource.set(k, (earnedBySource.get(k) ?? 0) + v);
    for (const l of ledger) if (l.pearls > 0) addSrc(ledgerCategory(l.source), l.pearls);
    let coinsEarned = 0;
    let pearlsEarned = 0;
    for (const [uid, t] of tallies) {
      addSrc('daily_login', t.directPearls.daily_login);
      addSrc('first_catch', t.directPearls.first_catch);
      addSrc('treasure', t.directPearls.treasure);
      coinsEarned += t.coinsSold + t.coinsJunkTreasure + t.bjNet + ledger.filter((l) => l.userId === uid).reduce((s, l) => s + l.coins, 0);
    }
    for (const v of earnedBySource.values()) pearlsEarned += v;
    const n = PROFILES.length;
    const perPlayerDay = (v: number): number => Math.round((v / n / DAYS) * 10) / 10;
    const levels = PROFILES.map((p) => getPlayer(ctx, p.id)!.level);
    const totalCasts = [...tallies.values()].reduce((s, t) => s + t.casts, 0);
    const sessionsPerDay = sessions.length / n / DAYS;
    const fishingOnlyPearls = (earnedBySource.get('first_catch') ?? 0) + (earnedBySource.get('treasure') ?? 0);
    const summary = {
      sessionsPerPlayerDay: Math.round(sessionsPerDay * 10) / 10,
      castsPerSession: Math.round((totalCasts / sessions.length) * 10) / 10,
      avgCoinsPerDay: perPlayerDay(coinsEarned),
      avgCoinsFromSellingPerDay: perPlayerDay([...tallies.values()].reduce((s, t) => s + t.coinsSold, 0)),
      avgPearlsPerDay: perPlayerDay(pearlsEarned),
      pearlsPerDayBySource: Object.fromEntries([...earnedBySource].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, perPlayerDay(v)])),
      chestsAffordablePerWeek: {
        wood: Math.round(((pearlsEarned / n / DAYS) * 7) / BALANCE.chests.prices.wood),
        silver: Math.round((((pearlsEarned / n / DAYS) * 7) / BALANCE.chests.prices.silver) * 10) / 10,
        gold: Math.round((((pearlsEarned / n / DAYS) * 7) / BALANCE.chests.prices.gold) * 10) / 10,
      },
      chestsOpened: [...tallies.values()].reduce((s, t) => s + t.chests, 0),
      levelsAfter14Days: { min: Math.min(...levels), avg: Math.round((levels.reduce((a, b) => a + b, 0) / n) * 10) / 10, max: Math.max(...levels) },
      passLevels: PROFILES.map((p) => tallies.get(p.id)!.passLevel),
      bosses: prepare(ctx.db, 'SELECT status, COUNT(*) AS n FROM bosses GROUP BY status').all(),
      blackjackHands: [...tallies.values()].reduce((s, t) => s + t.bjHands, 0),
      notices: noticeCount.n,
    };
    console.log('[economy summary]', JSON.stringify(summary, null, 2));

    // balance sanity (spec §1/§5): short sessions ~12 casts; pearls are NOT farmable by fishing alone
    expect(summary.castsPerSession).toBeGreaterThanOrEqual(8);
    expect(summary.castsPerSession).toBeLessThanOrEqual(16);
    expect(perPlayerDay(earnedBySource.get('treasure') ?? 0)).toBeLessThan(2);
    // first-catch pearls are bounded by the species catalog → they dry up; fishing-only pearls are a minority
    expect(fishingOnlyPearls / pearlsEarned).toBeLessThan(0.35);

    // ───────────── season rollover: force it and check permanent progress survives ─────────────
    const season = getActiveSeason(ctx)!;
    const snapshot = PROFILES.map((p) => ({
      uid: p.id,
      balance: getBalance(ctx, p.id),
      level: getPlayer(ctx, p.id)!.level,
      gear: listOwnedGear(ctx, p.id).map((g) => `${g.def.id}+${g.item.upgrade}`).sort(),
      collection: prepare(ctx.db, 'SELECT species_id, count, best_weight FROM collection WHERE user_id = ? ORDER BY species_id').all(p.id),
      allCatches: stats.get(ctx, p.id, 'catches'),
    }));
    const passBefore = PROFILES.map((p) => getPassProgress(ctx, p.id, season.id)!.xp);
    expect(Math.max(...passBefore)).toBeGreaterThan(0);
    ctx.clock.set(season.endsAt + 60_000);
    const seasonJob = game.jobs.find((j) => j.name === 'season')!;
    await seasonJob.run(ctx);
    await seasonJob.run(ctx); // idempotent
    const next2 = getActiveSeason(ctx)!;
    expect(next2.id).toBe(season.id + 1);
    expect(rolloverIfDue(ctx)).toBeNull();
    expect(prepare(ctx.db, 'SELECT status FROM seasons WHERE id = ?').get(season.id)).toEqual({ status: 'ended' });
    for (const s of snapshot) {
      expect(getBalance(ctx, s.uid)).toEqual(s.balance);
      expect(getPlayer(ctx, s.uid)!.level).toBe(s.level);
      expect(listOwnedGear(ctx, s.uid).map((g) => `${g.def.id}+${g.item.upgrade}`).sort()).toEqual(s.gear);
      expect(prepare(ctx.db, 'SELECT species_id, count, best_weight FROM collection WHERE user_id = ? ORDER BY species_id').all(s.uid)).toEqual(s.collection);
      expect(stats.get(ctx, s.uid, 'catches')).toBe(s.allCatches);
      // the pass and seasonal ratings start from zero
      expect(getPassProgress(ctx, s.uid, next2.id)!.level).toBe(0);
      expect(stats.get(ctx, s.uid, 'total_weight', stats.scopeSeason(next2.id))).toBe(0);
      // the old season's pass is kept as history
      expect(getPassProgress(ctx, s.uid, season.id)!.xp).toBe(passBefore[snapshot.indexOf(s)]);
    }
    // top-3 of the season categories hold the permanent title
    const titled = PROFILES.filter((p) => listCosmetics(ctx, p.id).some((c) => c.cosmetic_id === seasonTitleId(season.id)));
    expect(titled.length).toBeGreaterThanOrEqual(3);
    const topPass = [...PROFILES].sort((a, b) => passBefore[PROFILES.indexOf(b)]! - passBefore[PROFILES.indexOf(a)]!)[0]!;
    expect(titled.map((p) => p.id)).toContain(topPass.id);
    // playing on in the new season works and counts into the new season's scope
    ctx.clock.advance(HOUR);
    const out = playCast(ctx, 'p1', { reactionMs: 200, reelAccuracy: 1, rng: sim, location: 'pond' });
    expect(out.ok).toBe(true);
    expect(stats.get(ctx, 'p1', 'casts', stats.scopeSeason(next2.id))).toBe(1);
    logSpy.mockRestore();
  }, 180_000);
});
