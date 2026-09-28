import { describe, expect, it } from 'vitest';
import { seededRng } from '../../src/core/rng.js';

describe('rng', () => {
  it('is deterministic for the same seed', () => {
    const a = seededRng(123);
    const b = seededRng(123);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seededRng(124).next()).not.toEqual(seqA[0]);
  });

  it('next() stays within [0,1)', () => {
    const r = seededRng(1);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() is inclusive and covers the range', () => {
    const r = seededRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('weighted() respects weights and skips zero weights', () => {
    const r = seededRng(99);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 20_000; i++) counts[r.weighted([{ item: 'a' as const, weight: 3 }, { item: 'b' as const, weight: 1 }, { item: 'c' as const, weight: 0 }])]++;
    expect(counts.c).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.7);
    expect(counts.a / counts.b).toBeLessThan(3.3);
  });

  it('chance() edge cases and pick()', () => {
    const r = seededRng(5);
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
    expect(['x', 'y']).toContain(r.pick(['x', 'y']));
    expect(() => r.pick([])).toThrow();
    const f = r.float(2, 3);
    expect(f).toBeGreaterThanOrEqual(2);
    expect(f).toBeLessThan(3);
  });
});
