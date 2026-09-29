import { describe, expect, it } from 'vitest';
import { commandsJson, loadRegistry } from '../../src/discord/registry.js';

describe('WP2 commands register', () => {
  it('all WP2 commands load with valid JSON and component prefixes', async () => {
    const reg = await loadRegistry();
    const names = commandsJson(reg).map((c) => c.name);
    for (const n of ['fish', 'sell', 'shop', 'buy', 'equip', 'gear', 'upgrade', 'use', 'inventory', 'daily', 'locations', 'collection']) expect(names).toContain(n);
    for (const p of ['fish', 'shop', 'inv', 'col']) expect(reg.components.has(p)).toBe(true);
  });
});
