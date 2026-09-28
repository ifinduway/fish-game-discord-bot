import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus, MAX_EVENT_DEPTH } from '../../src/core/events.js';
import { createTestContext } from '../helpers.js';

describe('EventBus', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs handlers in order and collects notices', () => {
    const ctx = createTestContext();
    const order: number[] = [];
    ctx.bus.on('level_up', (e) => {
      order.push(1);
      return [{ userId: e.userId, text: `a${e.level}` }];
    });
    ctx.bus.on('level_up', () => {
      order.push(2);
    });
    const notices = ctx.bus.emit({ type: 'level_up', userId: 'u', level: 3 }, ctx);
    expect(order).toEqual([1, 2]);
    expect(notices).toEqual([{ userId: 'u', text: 'a3' }]);
  });

  it('isolates handler errors', () => {
    const ctx = createTestContext();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    ctx.bus.on('cast', () => {
      throw new Error('boom');
    });
    ctx.bus.on('cast', (e) => [{ userId: e.userId, text: 'ok' }]);
    const notices = ctx.bus.emit({ type: 'cast', userId: 'u', location: 'pond', energySpent: 8 }, ctx);
    expect(notices).toEqual([{ userId: 'u', text: 'ok' }]);
    expect(err).toHaveBeenCalled();
  });

  it('supports nested emits with a depth guard', () => {
    const ctx = createTestContext();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let calls = 0;
    ctx.bus.on('level_up', (e, c) => {
      calls++;
      return c.bus.emit({ type: 'level_up', userId: e.userId, level: e.level + 1 }, c);
    });
    ctx.bus.emit({ type: 'level_up', userId: 'u', level: 1 }, ctx);
    expect(calls).toBe(MAX_EVENT_DEPTH);
  });

  it('emit without handlers returns []', () => {
    const bus = new EventBus();
    expect(bus.emit({ type: 'boss_finished', bossId: 1, defeated: true }, createTestContext())).toEqual([]);
  });
});
