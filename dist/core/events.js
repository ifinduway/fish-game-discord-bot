export const MAX_EVENT_DEPTH = 5;
/**
 * Synchronous typed event bus. Handlers run in registration order; a throwing handler is logged and skipped.
 * Handlers may emit further events (depth guard MAX_EVENT_DEPTH). `emit` returns all collected notices.
 */
export class EventBus {
    handlers = new Map();
    depth = 0;
    on(type, handler) {
        const list = this.handlers.get(type) ?? [];
        list.push(handler);
        this.handlers.set(type, list);
    }
    emit(e, ctx) {
        if (this.depth >= MAX_EVENT_DEPTH) {
            console.error(`[events] depth limit ${MAX_EVENT_DEPTH} reached, dropping event '${e.type}'`);
            return [];
        }
        const list = this.handlers.get(e.type);
        if (!list || list.length === 0)
            return [];
        const notices = [];
        this.depth++;
        try {
            for (const h of [...list]) {
                try {
                    const out = h(e, ctx);
                    if (Array.isArray(out))
                        notices.push(...out);
                }
                catch (err) {
                    console.error(`[events] handler for '${e.type}' failed:`, err);
                }
            }
        }
        finally {
            this.depth--;
        }
        return notices;
    }
    /** Emits several events in order and concatenates their notices. */
    emitAll(events, ctx) {
        const out = [];
        for (const e of events)
            out.push(...this.emit(e, ctx));
        return out;
    }
    listenerCount(type) {
        return this.handlers.get(type)?.length ?? 0;
    }
    /** Removes all handlers (tests). */
    clear() {
        this.handlers.clear();
    }
}
//# sourceMappingURL=events.js.map