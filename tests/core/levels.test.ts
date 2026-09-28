import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import { applyXp, totalXp, xpToNext } from '../../src/game/levels.js';
import { addXp } from '../../src/services/player.js';
import { LOCATION_BY_ID } from '../../src/data/locations.js';
import { createTestContext, seedPlayer } from '../helpers.js';

describe('levels curve', () => {
  it('is strictly increasing', () => {
    for (let l = 1; l < 60; l++) expect(xpToNext(l + 1)).toBeGreaterThan(xpToNext(l));
    expect(xpToNext(1)).toBe(BALANCE.levels.base);
  });

  it('applyXp handles multi-level gains and remainder', () => {
    const need = xpToNext(1) + xpToNext(2);
    const r = applyXp(1, 0, need + 7);
    expect(r.level).toBe(3);
    expect(r.xp).toBe(7);
    expect(r.levelsGained).toEqual([2, 3]);
    expect(totalXp(r.level, r.xp)).toBe(need + 7);
  });

  it('stops at the cap', () => {
    const r = applyXp(BALANCE.levels.cap, 0, 1e9);
    expect(r.level).toBe(BALANCE.levels.cap);
    expect(r.levelsGained).toEqual([]);
  });

  it('addXp emits level_up and returns notices (incl. unlocked location)', () => {
    const ctx = createTestContext();
    seedPlayer(ctx, 'u1');
    const seen: number[] = [];
    ctx.bus.on('level_up', (e) => {
      seen.push(e.level);
    });
    let need = 0;
    for (let l = 1; l < BALANCE.locationUnlockLevels.river; l++) need += xpToNext(l);
    const res = addXp(ctx, 'u1', need);
    expect(res.level).toBe(BALANCE.locationUnlockLevels.river);
    expect(seen).toEqual([2, 3, 4, 5]);
    expect(res.notices.some((n) => n.text.includes(LOCATION_BY_ID.river.name))).toBe(true);
  });
});
