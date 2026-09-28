// Server boss lifecycle: spawn (schedule Tue/Fri 18:00 server tz, or admin), damage from fish_caught at the boss location,
// defeat (atomic status flip) → tiered rewards by contribution share + slayer title, expiry → consolation. Rewards exactly once.
//
// Decisions:
// - max_hp = hpPerPlayer × max(BALANCE.boss.minPlayers, active players) where active = distinct users with `casts` > 0
//   in the 'd:<dayKey>' stats scopes of the last BALANCE.boss.activeWindowDays days (see services/server.countActivePlayers).
// - Contribution records the damage actually applied (capped by remaining hp).
// - A scheduled boss expires at slot + durationHours (even if spawned late after a restart); an admin boss at now + durationHours.
// - If the title cosmetic BOSS_SLAYER_TITLE is not in the catalog, it is stored raw via addCosmetic (grant never fails).
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { EventOf, Notice } from '../core/events.js';
import { BOSSES, BOSS_BY_ID } from '../data/bosses.js';
import { COSMETIC_BY_ID } from '../data/cosmetics.js';
import { LOCATION_BY_ID } from '../data/locations.js';
import type { BossDef, Reward } from '../data/types.js';
import { prepare } from '../db/database.js';
import { addCosmetic } from '../db/repos/inventory.js';
import { markRun } from '../db/repos/periodic.js';
import { incServerStat } from '../db/repos/server-stats.js';
import {
  BOSS_SLAYER_TITLE,
  BOSS_SLAYER_TITLE_NAME,
  bossSlotKey,
  computeBossDamage,
  computeBossMaxHp,
  distributeBossRewards,
  latestBossSlot,
  type BossPayout,
} from '../game/boss.js';
import type { BossCardData } from '../render/types.js';
import { announceBoss } from './announce.js';
import { playerName } from './leaderboard.js';
import { grantReward } from './rewards.js';
import { countActivePlayers } from './server.js';

export interface BossRow {
  id: number;
  boss_def_id: string;
  location: string;
  max_hp: number;
  hp: number;
  spawned_at: number;
  expires_at: number;
  status: 'active' | 'defeated' | 'expired';
  rewarded: number;
}

export interface BossContribution {
  userId: string;
  username: string;
  damage: number;
  hits: number;
}

/** User-facing error (Russian message) for admin / command layers. */
export class BossError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BossError';
  }
}

const HOUR = 3_600_000;

export function bossDef(row: Pick<BossRow, 'boss_def_id'>): BossDef {
  return BOSS_BY_ID[row.boss_def_id] ?? { id: row.boss_def_id, name: 'Босс', emoji: '🐉', location: 'lake', hpPerPlayer: 500, description: '' };
}

export function getBoss(ctx: GameContext, id: number): BossRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM bosses WHERE id = ?').get(id) as BossRow | undefined;
}

/** Boss with status 'active' (may be past expires_at until the job expires it). */
export function getActiveBoss(ctx: GameContext): BossRow | undefined {
  return prepare(ctx.db, "SELECT * FROM bosses WHERE status = 'active' ORDER BY id DESC LIMIT 1").get() as BossRow | undefined;
}

/** Most recent boss of any status. */
export function getLatestBoss(ctx: GameContext): BossRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM bosses ORDER BY id DESC LIMIT 1').get() as BossRow | undefined;
}

export function listContributions(ctx: GameContext, bossId: number, limit = -1): BossContribution[] {
  const rows = prepare(
    ctx.db,
    'SELECT user_id AS userId, damage, hits FROM boss_contributions WHERE boss_id = ? AND damage > 0 ORDER BY damage DESC, user_id ASC LIMIT ?',
  ).all(bossId, limit) as { userId: string; damage: number; hits: number }[];
  return rows.map((r) => ({ ...r, username: playerName(ctx, r.userId) }));
}

/** The user's contribution and 1-based place (null if no damage). */
export function getUserContribution(ctx: GameContext, bossId: number, userId: string): { damage: number; hits: number; place: number } | null {
  const r = prepare(ctx.db, 'SELECT damage, hits FROM boss_contributions WHERE boss_id = ? AND user_id = ?').get(bossId, userId) as
    | { damage: number; hits: number }
    | undefined;
  if (!r || r.damage <= 0) return null;
  const n = prepare(
    ctx.db,
    'SELECT COUNT(*) AS n FROM boss_contributions WHERE boss_id = ? AND (damage > ? OR (damage = ? AND user_id < ?))',
  ).get(bossId, r.damage, r.damage, userId) as { n: number };
  return { ...r, place: n.n + 1 };
}

function insertBoss(ctx: GameContext, def: BossDef, expiresAt: number): BossRow {
  const now = ctx.clock.now();
  const maxHp = computeBossMaxHp(def.hpPerPlayer, countActivePlayers(ctx, BALANCE.boss.activeWindowDays));
  const r = prepare(
    ctx.db,
    "INSERT INTO bosses (boss_def_id, location, max_hp, hp, spawned_at, expires_at, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
  ).run(def.id, def.location, maxHp, maxHp, now, expiresAt);
  return getBoss(ctx, Number(r.lastInsertRowid))!;
}

function pickDef(ctx: GameContext, bossDefId?: string): BossDef {
  if (bossDefId) {
    const def = BOSS_BY_ID[bossDefId];
    if (!def) throw new BossError(`Неизвестный босс: ${bossDefId}`);
    return def;
  }
  if (BOSSES.length === 0) throw new BossError('В каталоге нет боссов.');
  return ctx.rng.pick(BOSSES);
}

/**
 * Spawns a boss now (admin / WP7). Expires due bosses first; throws BossError if a boss is still active.
 * Lives BALANCE.boss.durationHours.
 */
export function spawnBoss(ctx: GameContext, opts: { bossDefId?: string } = {}): BossRow {
  expireDueBosses(ctx);
  const row = ctx.db.transaction(() => {
    const active = getActiveBoss(ctx);
    if (active) throw new BossError(`Босс уже активен: ${bossDef(active).name}.`);
    return insertBoss(ctx, pickDef(ctx, opts.bossDefId), ctx.clock.now() + BALANCE.boss.durationHours * HOUR);
  })();
  void announceSpawn(ctx, row);
  return row;
}

/** Admin: ends the current boss as 'expired' (participants get the consolation). Throws BossError if none. */
export function endBoss(ctx: GameContext): void {
  const active = getActiveBoss(ctx);
  if (!active) throw new BossError('Сейчас нет активного босса.');
  finishBoss(ctx, active.id, 'expired');
}

/**
 * Scheduled spawn (job): if the latest schedule slot is within its life window, no boss is active and the slot
 * was not used yet (periodic_runs 'boss_spawn' + slot key) → spawn. Returns the new boss or null.
 */
export function runScheduledBossSpawn(ctx: GameContext): BossRow | null {
  const now = ctx.clock.now();
  const tz = ctx.config.timezone;
  const slot = latestBossSlot(now, tz);
  const life = BALANCE.boss.durationHours * HOUR;
  if (slot === null || now - slot >= life) return null;
  const row = ctx.db.transaction((): BossRow | null => {
    if (getActiveBoss(ctx)) return null; // e.g. admin boss still alive → retry on the next tick
    if (!markRun(ctx, 'boss_spawn', bossSlotKey(slot, tz))) return null;
    if (BOSSES.length === 0) return null;
    return insertBoss(ctx, ctx.rng.pick(BOSSES), slot + life);
  })();
  if (row) void announceSpawn(ctx, row);
  return row;
}

export interface BossHitResult {
  boss: BossRow;
  damage: number;
  firstHit: boolean;
}

/** Subscriber body (fish_caught): damages the active boss at the catch location, emits boss_damage and finishes on 0 hp. */
export function handleBossCatch(ctx: GameContext, e: EventOf<'fish_caught'>): Notice[] {
  const now = ctx.clock.now();
  const hit = ctx.db.transaction((): BossHitResult | null => {
    const boss = getActiveBoss(ctx);
    if (!boss || boss.location !== e.location || boss.expires_at <= now || boss.hp <= 0) return null;
    const damage = Math.min(boss.hp, computeBossDamage(e));
    const upd = prepare(ctx.db, "UPDATE bosses SET hp = MAX(0, hp - ?) WHERE id = ? AND status = 'active' AND hp > 0").run(damage, boss.id);
    if (upd.changes === 0) return null;
    const prev = prepare(ctx.db, 'SELECT hits FROM boss_contributions WHERE boss_id = ? AND user_id = ?').get(boss.id, e.userId) as
      | { hits: number }
      | undefined;
    prepare(
      ctx.db,
      `INSERT INTO boss_contributions (boss_id, user_id, damage, hits) VALUES (?, ?, ?, 1)
       ON CONFLICT(boss_id, user_id) DO UPDATE SET damage = damage + excluded.damage, hits = hits + 1`,
    ).run(boss.id, e.userId, damage);
    return { boss: getBoss(ctx, boss.id)!, damage, firstHit: !prev };
  })();
  if (!hit) return [];
  const def = bossDef(hit.boss);
  const notices: Notice[] = [
    { userId: e.userId, text: `⚔️ ${def.emoji} ${def.name}: −${hit.damage} HP (осталось ${hit.boss.hp}/${hit.boss.max_hp})` },
  ];
  notices.push(...ctx.bus.emit({ type: 'boss_damage', userId: e.userId, bossId: hit.boss.id, damage: hit.damage }, ctx));
  if (hit.boss.hp <= 0) {
    const res = finishBoss(ctx, hit.boss.id, 'defeated');
    if (res) {
      const mine = res.payouts.find((p) => p.userId === e.userId);
      notices.push({
        userId: e.userId,
        text: `🏆 Босс ${def.name} повержен!${mine ? ` Твоя награда: ${mine.summary}` : ''}`,
      });
      notices.push(...res.notices);
    }
  }
  return notices;
}

export interface BossFinishResult {
  boss: BossRow;
  outcome: 'defeated' | 'expired';
  payouts: (BossPayout & { username: string; summary: string })[];
  notices: Notice[];
}

/**
 * Ends a boss (atomic `UPDATE … WHERE status='active'`): null if it was already finished.
 * Rewards are granted once (rewarded flag), boss_finished is emitted after commit, then announced.
 */
export function finishBoss(ctx: GameContext, bossId: number, outcome: 'defeated' | 'expired'): BossFinishResult | null {
  const res = ctx.db.transaction((): BossFinishResult | null => {
    const upd = prepare(ctx.db, "UPDATE bosses SET status = ? WHERE id = ? AND status = 'active'").run(outcome, bossId);
    if (upd.changes === 0) return null;
    const payouts: BossFinishResult['payouts'] = [];
    const notices: Notice[] = [];
    const claim = prepare(ctx.db, 'UPDATE bosses SET rewarded = 1 WHERE id = ? AND rewarded = 0').run(bossId);
    if (claim.changes > 0) {
      const contributions = listContributions(ctx, bossId);
      for (const p of distributeBossRewards(contributions, outcome)) {
        const reward: Reward = { ...p.reward };
        const titleInCatalog = !!COSMETIC_BY_ID[BOSS_SLAYER_TITLE];
        if (p.slayer && titleInCatalog) reward.cosmetics = [BOSS_SLAYER_TITLE];
        const g = grantReward(ctx, p.userId, reward, `boss:${bossId}`);
        let summary = g.summary;
        if (p.slayer && !titleInCatalog && addCosmetic(ctx, p.userId, BOSS_SLAYER_TITLE, ctx.clock.now(), `boss:${bossId}`)) {
          summary += ` · 🏷️ ${BOSS_SLAYER_TITLE_NAME}`;
        }
        notices.push(...g.notices);
        payouts.push({ ...p, username: playerName(ctx, p.userId), summary });
      }
    }
    if (outcome === 'defeated') incServerStat(ctx, 'bosses_defeated', 1);
    return { boss: getBoss(ctx, bossId)!, outcome, payouts, notices };
  })();
  if (!res) return null;
  res.notices.push(...ctx.bus.emit({ type: 'boss_finished', bossId, defeated: outcome === 'defeated' }, ctx));
  void announceFinish(ctx, res);
  return res;
}

/** Expires every active boss whose expires_at has passed. */
export function expireDueBosses(ctx: GameContext): BossFinishResult[] {
  const due = prepare(ctx.db, "SELECT id FROM bosses WHERE status = 'active' AND expires_at <= ? ORDER BY id").all(ctx.clock.now()) as { id: number }[];
  const out: BossFinishResult[] = [];
  for (const { id } of due) {
    const r = finishBoss(ctx, id, 'expired');
    if (r) out.push(r);
  }
  return out;
}

/** Card data for renderBossCard (top N contributors). */
export function buildBossCard(ctx: GameContext, boss: BossRow, topN: number = BALANCE.boss.topShown): BossCardData {
  const def = bossDef(boss);
  return {
    name: def.name,
    emoji: def.emoji,
    hp: boss.hp,
    maxHp: boss.max_hp,
    expiresAt: boss.expires_at,
    location: locationLabel(boss.location),
    status: boss.status,
    top: listContributions(ctx, boss.id, topN).map((c) => ({ username: c.username, damage: c.damage })),
  };
}

export function locationLabel(location: string): string {
  const loc = LOCATION_BY_ID[location as keyof typeof LOCATION_BY_ID];
  return loc ? `${loc.emoji} ${loc.name}` : location;
}

async function announceSpawn(ctx: GameContext, boss: BossRow): Promise<void> {
  const def = bossDef(boss);
  await announceBoss(
    ctx,
    {
      title: `${def.emoji} Появился босс: ${def.name}!`,
      description: `${def.description}\n\nЛокация: **${locationLabel(boss.location)}** · HP: **${boss.max_hp.toLocaleString('ru-RU')}**\nУходит <t:${Math.floor(boss.expires_at / 1000)}:R>. Ловите рыбу в этой локации, чтобы нанести урон! (/boss)`,
      color: 0xc0392b,
    },
    buildBossCard(ctx, boss),
  );
}

async function announceFinish(ctx: GameContext, r: BossFinishResult): Promise<void> {
  const def = bossDef(r.boss);
  const lines = r.payouts
    .slice(0, 10)
    .map((p) => `${p.place}. <@${p.userId}> — ${p.damage.toLocaleString('ru-RU')} урона (${Math.round(p.share * 100)}%) → ${p.summary}`);
  const more = r.payouts.length > 10 ? `\n…и ещё ${r.payouts.length - 10} участников` : '';
  await announceBoss(
    ctx,
    r.outcome === 'defeated'
      ? {
          title: `🏆 ${def.emoji} ${def.name} повержен!`,
          description: `${r.payouts[0] ? `Гроза боссов: <@${r.payouts[0].userId}>!\n\n` : ''}${lines.join('\n')}${more}`,
          color: 0x2ecc71,
        }
      : {
          title: `💨 ${def.emoji} ${def.name} уплыл…`,
          description: r.payouts.length
            ? `Босс ушёл. Участники получают утешительную награду.\n\n${lines.join('\n')}${more}`
            : 'Босс ушёл, так и не встретив соперников.',
          color: 0x7f8c8d,
        },
    buildBossCard(ctx, r.boss),
  );
}
