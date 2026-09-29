import { describe, expect, it } from 'vitest';
import { BALANCE } from '../../src/config/balance.js';
import {
  applyReelResult,
  evaluateHook,
  evaluateReelPress,
  hookWindow,
  reelEscapeThreshold,
  reelRoundTime,
  reelRounds,
  type ReelPress,
  type ReelState,
} from '../../src/game/fishing-session.js';

const F = BALANCE.fishing;

describe('hook timing', () => {
  it('window = 2000 + rod bonus + 400 grace; perfect = first 40% of the base window', () => {
    expect(hookWindow(0)).toEqual({ baseMs: 2000, totalMs: 2400, perfectMs: 800 });
    expect(hookWindow(500)).toEqual({ baseMs: 2500, totalMs: 2900, perfectMs: 1000 });
  });

  it('classifies presses relative to when «Клюёт!» became visible', () => {
    const w = hookWindow(0);
    const shown = 10_000;
    expect(evaluateHook(shown, shown, w)).toBe('perfect');
    expect(evaluateHook(shown, shown + 800, w)).toBe('perfect');
    expect(evaluateHook(shown, shown + 801, w)).toBe('ok');
    expect(evaluateHook(shown, shown + 2400, w)).toBe('ok');
    expect(evaluateHook(shown, shown + 2401, w)).toBe('late');
    // rod bonus widens both zones
    expect(evaluateHook(shown, shown + 950, hookWindow(500))).toBe('perfect');
    expect(evaluateHook(shown, shown + 2800, hookWindow(500))).toBe('ok');
  });
});

describe('reel mini-game rules', () => {
  it('rounds: none below rare, rare = 2, epic+ = 3', () => {
    expect(reelRounds('common')).toBe(0);
    expect(reelRounds('uncommon')).toBe(0);
    expect(reelRounds('rare')).toBe(2);
    expect(reelRounds('epic')).toBe(3);
    expect(reelRounds('mythic')).toBe(3);
  });

  it('round time = 3 s + reel bonus; wrong or slow press is a miss', () => {
    expect(reelRoundTime(0)).toBe(3000);
    expect(reelRoundTime(400)).toBe(3400);
    const t = 3000;
    expect(evaluateReelPress('up', 'up', 0, 1000, t)).toBe('hit');
    expect(evaluateReelPress('up', 'left', 0, 1000, t)).toBe('miss');
    expect(evaluateReelPress('up', 'up', 0, t + F.latencyGraceMs + 1, t)).toBe('miss');
    expect(evaluateReelPress('up', null, 0, 1000, t)).toBe('miss');
  });

  function play(rounds: number, lineBonus: number, results: ReelPress[]) {
    let s: ReelState = { rounds, round: 0, mistakes: 0, escapeAt: reelEscapeThreshold(lineBonus) };
    let status = 'continue';
    for (const r of results) {
      const out = applyReelResult(s, r);
      s = out.state;
      status = out.status;
      if (status !== 'continue') break;
    }
    return { status, mistakes: s.mistakes };
  }

  it('without line bonus: one mistake is survivable, two mistakes lose the fish', () => {
    expect(reelEscapeThreshold(0)).toBe(2);
    expect(play(3, 0, ['hit', 'hit', 'hit'])).toEqual({ status: 'done', mistakes: 0 });
    expect(play(3, 0, ['miss', 'hit', 'hit'])).toEqual({ status: 'done', mistakes: 1 });
    expect(play(3, 0, ['miss', 'miss'])).toEqual({ status: 'escaped', mistakes: 2 });
    expect(play(2, 0, ['hit', 'miss'])).toEqual({ status: 'done', mistakes: 1 });
  });

  it('line bonus allows one extra mistake', () => {
    expect(reelEscapeThreshold(1)).toBe(3);
    expect(play(3, 1, ['miss', 'miss', 'hit'])).toEqual({ status: 'done', mistakes: 2 });
    expect(play(3, 1, ['miss', 'miss', 'miss'])).toEqual({ status: 'escaped', mistakes: 3 });
  });
});
