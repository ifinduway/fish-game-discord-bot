import type { EventBus } from '../../../src/core/events.js';

export default function register(bus: EventBus): void {
  bus.on('level_up', (e) => [{ userId: e.userId, text: `fixture:${e.level}` }]);
}
