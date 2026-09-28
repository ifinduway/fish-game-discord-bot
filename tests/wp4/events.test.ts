import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import type { GameEvent } from '../../src/core/events.js';
import { dayKey } from '../../src/core/time.js';
import { getBalance } from '../../src/db/repos/wallet.js';
import { autoEventHour, rankTournament, tournamentPrize } from '../../src/game/server-events.js';
import eventsJob from '../../src/scheduler/jobs/server-events.js';
import {
  ServerEventError,
  finishDueServerEvents,
  getActiveServerEvent,
  getServerEvent,
  getTournamentStandings,
  runAutoServerEvent,
  startServerEvent,
} from '../../src/services/server-events.js';
import registerTournament from '../../src/subscribers/tournament.js';
import { createTestContext, seedPlayer } from '../helpers.js';

const MIN = 60_000;
const TZ = 'Europe/Moscow';

function fish(userId: string, weight: number, speciesId = 'sp'): GameEvent {
  return { type: 'fish_caught', userId, speciesId, rarity: 'common', weight, quality: 1, perfect: false, location: 'pond', value: 1, firstOfSpecies: false, seasonal: false };
}

describe('game/server-events', () => {
  it('prizes, ranking, deterministic auto hour', () => {
    expect(tournamentPrize(1)).toEqual({ pearls: BALANCE.events.tournamentPrizes[0]!.pearls, coins: BALANCE.events.tournamentPrizes[0]!.coins });
    expect(tournamentPrize(BALANCE.events.tournamentPrizes.length + 1)).toBeNull();
    expect(rankTournament([{ userId: 'b', bestWeight: 2, speciesId: 'x' }, { userId: 'a', bestWeight: 2, speciesId: 'x' }, { userId: 'c', bestWeight: 3, speciesId: 'x' }]).map((e) => e.userId)).toEqual(['c', 'a', 'b']);
    const h = autoEventHour('2026-01-05');
    expect(h).toBe(autoEventHour('2026-01-05'));
    expect(h).toBeGreaterThanOrEqual(BALANCE.events.auto.hourMin);
    expect(h).toBeLessThanOrEqual(BALANCE.events.auto.hourMax);
  });
});

describe('server events', () => {
  it('bite_hour: active window semantics, duplicates rejected, finished after 1 h', () => {
    const ctx = createTestContext();
    const e = startServerEvent(ctx, 'bite_hour');
    expect(e.ends_at - e.starts_at).toBe(BALANCE.events.biteHourMinutes * MIN);
    expect(() => startServerEvent(ctx, 'bite_hour')).toThrow(ServerEventError);
    // the query WP2 uses
    const q = () =>
      ctx.db
        .prepare("SELECT COUNT(*) AS n FROM server_events WHERE type = 'bite_hour' AND status = 'active' AND starts_at <= ? AND ends_at > ?")
        .get(ctx.clock.now(), ctx.clock.now()) as { n: number };
    expect(q().n).toBe(1);
    ctx.clock.advance(BALANCE.events.biteHourMinutes * MIN);
    expect(q().n).toBe(0);
    expect(getActiveServerEvent(ctx, 'bite_hour')).toBeUndefined();
    finishDueServerEvents(ctx);
    expect(getServerEvent(ctx, e.id)!.status).toBe('finished');
    expect(startServerEvent(ctx, 'bite_hour').id).not.toBe(e.id);
  });

  it('tournament records best weight and awards top-3 exactly once', () => {
    const ctx = createTestContext();
    registerTournament(ctx.bus);
    for (const u of ['u1', 'u2', 'u3', 'u4']) seedPlayer(ctx, u);
    ctx.bus.emit(fish('u3', 50), ctx); // before the tournament → ignored
    const t = startServerEvent(ctx, 'tournament');
    ctx.bus.emit(fish('u1', 3), ctx);
    ctx.bus.emit(fish('u2', 5), ctx);
    ctx.bus.emit(fish('u1', 7, 'big'), ctx);
    ctx.bus.emit(fish('u1', 2), ctx); // lighter → keeps 7
    ctx.bus.emit(fish('u3', 1), ctx);
    ctx.bus.emit(fish('u4', 2), ctx);
    const st = getTournamentStandings(ctx, t.id);
    expect(st.map((s) => [s.userId, s.bestWeight])).toEqual([
      ['u1', 7],
      ['u2', 5],
      ['u4', 2],
      ['u3', 1],
    ]);
    expect(st[0]!.speciesId).toBe('big');

    ctx.clock.advance(BALANCE.events.tournamentMinutes * MIN + 1);
    ctx.bus.emit(fish('u3', 99), ctx); // after the end → ignored
    eventsJob.run(ctx);
    eventsJob.run(ctx);
    expect(finishDueServerEvents(ctx)).toEqual([]);

    const prizes = BALANCE.events.tournamentPrizes;
    expect(getBalance(ctx, 'u1')).toEqual({ coins: prizes[0]!.coins, pearls: prizes[0]!.pearls });
    expect(getBalance(ctx, 'u2')).toEqual({ coins: prizes[1]!.coins, pearls: prizes[1]!.pearls });
    expect(getBalance(ctx, 'u4')).toEqual({ coins: prizes[2]!.coins, pearls: prizes[2]!.pearls });
    expect(getBalance(ctx, 'u3')).toEqual({ coins: 0, pearls: 0 });
    expect(getServerEvent(ctx, t.id)).toMatchObject({ status: 'finished', rewarded: 1 });
  });

  it('automatic events: at most one per day, only at the chosen hour', () => {
    const hour = autoEventHour(dayKey(Date.UTC(2026, 0, 5, 9, 0), TZ));
    const at = (h: number, m: number): number => Date.UTC(2026, 0, 5, h - 3, m); // MSK = UTC+3
    const ctx = createTestContext({ now: at(hour, 0) - MIN }); // previous hour → nothing
    expect(runAutoServerEvent(ctx)).toBeNull();
    ctx.clock.set(at(hour, 10));
    for (let n = 0; n < 5; n++) {
      runAutoServerEvent(ctx);
      ctx.clock.advance(5 * MIN);
    }
    const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM server_events').get() as { n: number }).n;
    expect(n).toBeLessThanOrEqual(1);
    expect(ctx.db.prepare("SELECT period_key FROM periodic_runs WHERE job = 'auto_event'").all()).toEqual([{ period_key: '2026-01-05' }]);
  });
});
