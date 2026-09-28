export const systemClock = { now: () => Date.now() };
/** Manually driven clock for tests. */
export class FakeClock {
    t;
    constructor(t = Date.UTC(2026, 0, 5, 9, 0, 0)) {
        this.t = t;
    }
    now() {
        return this.t;
    }
    set(ms) {
        this.t = ms;
    }
    advance(ms) {
        this.t += ms;
    }
}
//# sourceMappingURL=clock.js.map