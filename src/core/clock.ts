export interface Clock {
  /** ms since epoch */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Manually driven clock for tests. */
export class FakeClock implements Clock {
  constructor(private t: number = Date.UTC(2026, 0, 5, 9, 0, 0)) {}
  now(): number {
    return this.t;
  }
  set(ms: number): void {
    this.t = ms;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
