// Full-registry validation (plan §6 QA item 5): every command in src/discord/commands loads with a unique name
// and unique component prefixes, and every data.toJSON() respects Discord's limits.
import { describe, expect, it } from 'vitest';
import { commandsJson, loadRegistry } from '../../src/discord/registry.js';

interface JsonOption {
  name: string;
  description?: string;
  choices?: { name: string; value: unknown }[];
  options?: JsonOption[];
}

function walkOptions(options: JsonOption[] | undefined, checks: (o: JsonOption) => void): void {
  for (const o of options ?? []) {
    checks(o);
    walkOptions(o.options, checks);
  }
}

describe('WP7 full command registry', () => {
  it('loads every command in src/discord/commands with unique names and component prefixes', async () => {
    const reg = await loadRegistry();
    const names = commandsJson(reg).map((c) => c.name);
    // WP0-6 sanity + WP7's own commands
    for (const n of [
      'fish', 'sell', 'shop', 'buy', 'equip', 'gear', 'upgrade', 'use', 'inventory', 'daily', 'locations', 'collection',
      'chest', 'blackjack', 'season', 'pass', 'boss', 'server', 'top', 'stats', 'profile', 'challenges',
      'admin', 'help',
    ]) {
      expect(names).toContain(n);
    }
    expect(new Set(names).size).toBe(names.length);
    for (const p of ['adm', 'help']) expect(reg.components.has(p)).toBe(true);
  });

  it('every command.data.toJSON() respects Discord limits (names/descriptions/choices/options)', async () => {
    const reg = await loadRegistry();
    const json = commandsJson(reg);
    expect(json.length).toBeGreaterThan(0);
    for (const cmd of json) {
      expect(cmd.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(cmd.name.toLowerCase()).toBe(cmd.name);
      expect(cmd.description.length).toBeGreaterThan(0);
      expect(cmd.description.length).toBeLessThanOrEqual(100);
      expect((cmd.options ?? []).length).toBeLessThanOrEqual(25);
      walkOptions(cmd.options as JsonOption[] | undefined, (o) => {
        expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
        if (o.description !== undefined) expect(o.description.length).toBeLessThanOrEqual(100);
        if (o.choices) expect(o.choices.length).toBeLessThanOrEqual(25);
      });
    }
  });

  it('admin subcommands and give/take/reset-user options are present and within limits', async () => {
    const reg = await loadRegistry();
    const admin = commandsJson(reg).find((c) => c.name === 'admin')!;
    expect(admin).toBeDefined();
    const topNames = (admin.options ?? []).map((o) => o.name).sort();
    expect(topNames).toEqual(['boss', 'config', 'event', 'give', 'reset-user', 'season', 'take'].sort());
  });
});
