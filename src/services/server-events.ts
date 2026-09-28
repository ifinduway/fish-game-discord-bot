// Server events: «Час клёва» (bite_hour — WP2 applies the rarity bonus by reading server_events directly:
// type='bite_hour' AND status='active' AND starts_at <= now < ends_at) and «Турнир» (tournament — heaviest fish in 1 h, top-3 prizes).
// Rows are closed ('finished') by the scheduler job after ends_at; tournament prizes are granted exactly once (rewarded flag).
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { EventOf } from '../core/events.js';
import { dayKey, localParts } from '../core/time.js';
import { FISH_BY_ID } from '../data/fish.js';
import { prepare } from '../db/database.js';
import { markRun } from '../db/repos/periodic.js';
import { placeLabel } from '../game/leaderboard.js';
import {
  SERVER_EVENT_INFO,
  SERVER_EVENT_TYPES,
  autoEventHour,
  eventDurationMs,
  rankTournament,
  tournamentPrize,
  type ServerEventType,
} from '../game/server-events.js';
import { announceLeaderboard, announcePayload } from './announce.js';
import { playerName } from './leaderboard.js';
import { grantReward } from './rewards.js';

export interface ServerEventRow {
  id: number;
  type: ServerEventType;
  starts_at: number;
  ends_at: number;
  status: 'active' | 'finished';
  rewarded: number;
}

/** User-facing error (Russian message) for admin / command layers. */
export class ServerEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServerEventError';
  }
}

/** Events running right now (status active and starts_at <= now < ends_at). */
export function getActiveServerEvents(ctx: GameContext): ServerEventRow[] {
  const now = ctx.clock.now();
  return prepare(ctx.db, "SELECT * FROM server_events WHERE status = 'active' AND starts_at <= ? AND ends_at > ? ORDER BY starts_at").all(
    now,
    now,
  ) as ServerEventRow[];
}

export function getActiveServerEvent(ctx: GameContext, type: ServerEventType): ServerEventRow | undefined {
  return getActiveServerEvents(ctx).find((e) => e.type === type);
}

export function getServerEvent(ctx: GameContext, id: number): ServerEventRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM server_events WHERE id = ?').get(id) as ServerEventRow | undefined;
}

function insertEvent(ctx: GameContext, type: ServerEventType, durationMs: number): ServerEventRow {
  const now = ctx.clock.now();
  const r = prepare(ctx.db, "INSERT INTO server_events (type, starts_at, ends_at, status) VALUES (?, ?, ?, 'active')").run(type, now, now + durationMs);
  return getServerEvent(ctx, Number(r.lastInsertRowid))!;
}

/**
 * Starts an event now (admin or scheduler). Throws ServerEventError if the same type is already running.
 * Duration defaults to BALANCE.events.{biteHourMinutes|tournamentMinutes}.
 */
export function startServerEvent(ctx: GameContext, type: ServerEventType, opts: { durationMinutes?: number } = {}): ServerEventRow {
  if (!SERVER_EVENT_TYPES.includes(type)) throw new ServerEventError(`Неизвестное событие: ${type}`);
  finishDueServerEvents(ctx);
  const durationMs = opts.durationMinutes !== undefined ? Math.max(1, opts.durationMinutes) * 60_000 : eventDurationMs(type);
  const row = ctx.db.transaction(() => {
    if (getActiveServerEvent(ctx, type)) throw new ServerEventError(`Событие «${SERVER_EVENT_INFO[type].name}» уже идёт.`);
    return insertEvent(ctx, type, durationMs);
  })();
  void announceEventStart(ctx, row);
  return row;
}

async function announceEventStart(ctx: GameContext, e: ServerEventRow): Promise<void> {
  const info = SERVER_EVENT_INFO[e.type];
  await announcePayload(ctx, {
    title: `${info.emoji} Началось событие: ${info.name}!`,
    description: `${info.description}\nЗакончится <t:${Math.floor(e.ends_at / 1000)}:R>.`,
    color: 0xe67e22,
  });
}

/** Tournament subscriber body: keeps each user's heaviest fish during an active tournament. */
export function recordTournamentCatch(ctx: GameContext, e: EventOf<'fish_caught'>): void {
  const t = getActiveServerEvent(ctx, 'tournament');
  if (!t) return;
  prepare(
    ctx.db,
    `INSERT INTO tournament_entries (event_id, user_id, best_weight, species_id) VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET best_weight = excluded.best_weight, species_id = excluded.species_id
     WHERE excluded.best_weight > tournament_entries.best_weight`,
  ).run(t.id, e.userId, e.weight, e.speciesId);
}

export interface TournamentStanding {
  rank: number;
  userId: string;
  username: string;
  bestWeight: number;
  speciesId: string;
}

export function getTournamentStandings(ctx: GameContext, eventId: number, limit = 10): TournamentStanding[] {
  const rows = prepare(ctx.db, 'SELECT user_id AS userId, best_weight AS bestWeight, species_id AS speciesId FROM tournament_entries WHERE event_id = ?').all(
    eventId,
  ) as { userId: string; bestWeight: number; speciesId: string }[];
  return rankTournament(rows)
    .slice(0, limit)
    .map((r, i) => ({ rank: i + 1, userId: r.userId, username: playerName(ctx, r.userId), bestWeight: r.bestWeight, speciesId: r.speciesId }));
}

export interface FinishedServerEvent {
  event: ServerEventRow;
  /** tournament prize winners (empty for bite_hour) */
  winners: (TournamentStanding & { summary: string })[];
}

/** Closes one event (idempotent: null if already finished). Tournament prizes are granted once (rewarded flag). */
export function finishServerEvent(ctx: GameContext, eventId: number): FinishedServerEvent | null {
  const res = ctx.db.transaction((): FinishedServerEvent | null => {
    const upd = prepare(ctx.db, "UPDATE server_events SET status = 'finished' WHERE id = ? AND status = 'active'").run(eventId);
    if (upd.changes === 0) return null;
    const event = getServerEvent(ctx, eventId)!;
    const winners: FinishedServerEvent['winners'] = [];
    if (event.type === 'tournament') {
      const claim = prepare(ctx.db, 'UPDATE server_events SET rewarded = 1 WHERE id = ? AND rewarded = 0').run(eventId);
      if (claim.changes > 0) {
        const places = BALANCE.events.tournamentPrizes.length;
        for (const s of getTournamentStandings(ctx, eventId, places)) {
          const prize = tournamentPrize(s.rank);
          if (!prize) continue;
          const { summary } = grantReward(ctx, s.userId, prize, `tournament:${eventId}`);
          winners.push({ ...s, summary });
        }
      }
    }
    return { event: getServerEvent(ctx, eventId)!, winners };
  })();
  if (res) void announceEventEnd(ctx, res);
  return res;
}

/** Finishes all active events whose ends_at has passed. */
export function finishDueServerEvents(ctx: GameContext): FinishedServerEvent[] {
  const due = prepare(ctx.db, "SELECT id FROM server_events WHERE status = 'active' AND ends_at <= ? ORDER BY id").all(ctx.clock.now()) as { id: number }[];
  const out: FinishedServerEvent[] = [];
  for (const { id } of due) {
    const r = finishServerEvent(ctx, id);
    if (r) out.push(r);
  }
  return out;
}

async function announceEventEnd(ctx: GameContext, r: FinishedServerEvent): Promise<void> {
  const info = SERVER_EVENT_INFO[r.event.type];
  if (r.event.type !== 'tournament') {
    await announcePayload(ctx, { title: `${info.emoji} ${info.name} завершён`, description: 'Спасибо всем за участие!', color: 0x95a5a6 });
    return;
  }
  const rows = r.winners.map((w) => {
    const fish = FISH_BY_ID[w.speciesId];
    return { rank: w.rank, userId: w.userId, username: w.username, value: `${w.bestWeight.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} кг${fish ? ` · ${fish.name}` : ''}` };
  });
  await announceLeaderboard(
    ctx,
    {
      title: `${info.emoji} Турнир завершён!`,
      description: rows.length
        ? r.winners.map((w, i) => `${placeLabel(w.rank)} <@${w.userId}> — ${rows[i]!.value} → ${w.summary}`).join('\n')
        : 'Никто не поймал рыбу во время турнира.',
      color: 0xf1c40f,
    },
    { title: 'Турнир: самая тяжёлая рыба', subtitle: 'Итоги', rows },
  );
}

/**
 * Automatic events: at most one attempt per local day (periodic_runs 'auto_event' + dayKey), at the deterministic
 * hour autoEventHour(dayKey); with BALANCE.events.auto.chance a random event type starts (skipped if any event is running).
 */
export function runAutoServerEvent(ctx: GameContext): ServerEventRow | null {
  const cfg = BALANCE.events.auto;
  if (!cfg.enabled) return null;
  const now = ctx.clock.now();
  const tz = ctx.config.timezone;
  const dk = dayKey(now, tz);
  if (localParts(now, tz).hour !== autoEventHour(dk)) return null;
  const row = ctx.db.transaction((): ServerEventRow | null => {
    if (!markRun(ctx, 'auto_event', dk)) return null;
    if (getActiveServerEvents(ctx).length > 0) return null;
    if (!ctx.rng.chance(cfg.chance)) return null;
    const type = ctx.rng.pick(SERVER_EVENT_TYPES);
    return insertEvent(ctx, type, eventDurationMs(type));
  })();
  if (row) void announceEventStart(ctx, row);
  return row;
}

/** Russian one-liner for an active event, e.g. "🏆 Турнир — до 19:00 (<t:…:R>)". */
export function describeServerEvent(e: ServerEventRow): string {
  const info = SERVER_EVENT_INFO[e.type];
  return `${info.emoji} **${info.name}** — ${info.description} Закончится <t:${Math.floor(e.ends_at / 1000)}:R>.`;
}

