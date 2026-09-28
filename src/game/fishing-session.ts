// Hook timing & reel mini-game rules (spec §2, plan §8.9). Pure functions over timestamps.
import { BALANCE } from '../config/balance.js';
import { rarityAtLeast, rarityIndex, type Rarity } from '../data/types.js';

const F = BALANCE.fishing;

export type Direction = 'left' | 'up' | 'right';
export const DIRECTIONS: Direction[] = ['left', 'up', 'right'];
export const DIRECTION_EMOJI: Record<Direction, string> = { left: '⬅️', up: '⬆️', right: '➡️' };

export function isDirection(s: string): s is Direction {
  return (DIRECTIONS as string[]).includes(s);
}

export interface HookWindow {
  /** hookWindowMs + rod biteWindowMs */
  baseMs: number;
  /** base + latency grace: presses after this are late */
  totalMs: number;
  /** presses within this are perfect (perfectFraction of the base window) */
  perfectMs: number;
}

export function hookWindow(rodBiteWindowMs = 0): HookWindow {
  const baseMs = F.hookWindowMs + Math.max(0, rodBiteWindowMs);
  return { baseMs, totalMs: baseMs + F.latencyGraceMs, perfectMs: baseMs * F.perfectFraction };
}

export type HookResult = 'perfect' | 'ok' | 'late';

/** Evaluates a hook press. `shownAt` = when the «Клюёт!» edit resolved. */
export function evaluateHook(shownAt: number, pressedAt: number, w: HookWindow): HookResult {
  const elapsed = Math.max(0, pressedAt - shownAt);
  if (elapsed <= w.perfectMs) return 'perfect';
  if (elapsed <= w.totalMs) return 'ok';
  return 'late';
}

/** Number of reel rounds: 0 below reelMinRarity, rare → reelRoundsMin, epic+ → reelRoundsMax. */
export function reelRounds(r: Rarity): number {
  if (!rarityAtLeast(r, F.reelMinRarity)) return 0;
  return rarityIndex(r) > rarityIndex(F.reelMinRarity) ? F.reelRoundsMax : F.reelRoundsMin;
}

/** Mistakes at which the fish escapes: base (2) + integer line bonus. */
export function reelEscapeThreshold(lineMistakeBonus: number): number {
  return F.reelMistakesToEscape + Math.max(0, Math.floor(lineMistakeBonus));
}

/** Time shown to the player for one reel round (base + reel bonus). */
export function reelRoundTime(reelTimeBonusMs = 0): number {
  return F.reelRoundTimeMs + Math.max(0, reelTimeBonusMs);
}

export type ReelPress = 'hit' | 'miss';

/** A press is a hit if it is the target direction and arrives within roundTime + latency grace. `pressed=null` → timeout. */
export function evaluateReelPress(target: Direction, pressed: Direction | null, startedAt: number, pressedAt: number, roundTimeMs: number): ReelPress {
  if (pressed === null) return 'miss';
  if (pressedAt - startedAt > roundTimeMs + F.latencyGraceMs) return 'miss';
  return pressed === target ? 'hit' : 'miss';
}

export interface ReelState {
  rounds: number;
  /** 0-based index of the current round */
  round: number;
  mistakes: number;
  escapeAt: number;
}

export type ReelStatus = 'continue' | 'escaped' | 'done';

/** Applies a round result and advances to the next round. */
export function applyReelResult(s: ReelState, result: ReelPress): { state: ReelState; status: ReelStatus } {
  const mistakes = s.mistakes + (result === 'miss' ? 1 : 0);
  const state: ReelState = { ...s, mistakes, round: s.round + 1 };
  if (mistakes >= s.escapeAt) return { state, status: 'escaped' };
  if (state.round >= s.rounds) return { state, status: 'done' };
  return { state, status: 'continue' };
}
