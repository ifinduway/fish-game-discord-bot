/** mulberry32 PRNG: fast, deterministic, good enough for games. */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/** Wraps any [0,1) source into the Rng interface. */
export function createRng(source = Math.random) {
    const rng = {
        next: source,
        int(min, max) {
            const lo = Math.ceil(Math.min(min, max));
            const hi = Math.floor(Math.max(min, max));
            return lo + Math.floor(source() * (hi - lo + 1));
        },
        float(min, max) {
            return min + source() * (max - min);
        },
        pick(arr) {
            if (arr.length === 0)
                throw new Error('rng.pick: empty array');
            return arr[Math.floor(source() * arr.length)];
        },
        weighted(items) {
            let total = 0;
            for (const it of items)
                if (it.weight > 0)
                    total += it.weight;
            if (total <= 0)
                throw new Error('rng.weighted: no positive weights');
            let roll = source() * total;
            for (const it of items) {
                if (it.weight <= 0)
                    continue;
                roll -= it.weight;
                if (roll < 0)
                    return it.item;
            }
            // floating point edge: return last positive item
            for (let i = items.length - 1; i >= 0; i--)
                if (items[i].weight > 0)
                    return items[i].item;
            throw new Error('rng.weighted: unreachable');
        },
        chance(p) {
            if (p <= 0)
                return false;
            if (p >= 1)
                return true;
            return source() < p;
        },
    };
    return rng;
}
export function seededRng(seed) {
    return createRng(mulberry32(seed));
}
export const defaultRng = createRng(Math.random);
//# sourceMappingURL=rng.js.map