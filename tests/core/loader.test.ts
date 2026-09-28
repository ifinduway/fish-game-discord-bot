import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { basename } from 'node:path';
import { isLoadableFile, loadModules, loadSubscribers } from '../../src/core/loader.js';
import { loadJobs, runDueJobs } from '../../src/scheduler/index.js';
import { loadRegistry, registerModule, createRegistry, commandsJson } from '../../src/discord/registry.js';
import { parseCustomId } from '../../src/discord/router.js';
import { createTestContext } from '../helpers.js';

const fixture = (name: string): string => fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));

describe('loader', () => {
  it('filters file names', () => {
    expect(isLoadableFile('fish.ts')).toBe(true);
    expect(isLoadableFile('fish.js')).toBe(true);
    expect(isLoadableFile('fish.d.ts')).toBe(false);
    expect(isLoadableFile('fish.js.map')).toBe(false);
    expect(isLoadableFile('fish.test.ts')).toBe(false);
    expect(isLoadableFile('_util.ts')).toBe(false);
    expect(isLoadableFile('.gitkeep')).toBe(false);
    expect(isLoadableFile('readme.md')).toBe(false);
  });

  it('loads a fixture dir (sorted, ignoring non-modules)', async () => {
    const mods = await loadModules<{ default: string }>(fixture('loader'));
    expect(mods.map((m) => basename(m.file))).toEqual(['a.ts', 'b.ts']);
    expect(mods.map((m) => m.module.default)).toEqual(['a', 'b']);
  });

  it('returns [] for a missing dir', async () => {
    expect(await loadModules(fixture('does-not-exist'))).toEqual([]);
  });

  it('loads real (possibly empty) app dirs without throwing', async () => {
    const ctx = createTestContext();
    await expect(loadSubscribers(ctx.bus)).resolves.toBeInstanceOf(Array);
    await expect(loadJobs()).resolves.toBeInstanceOf(Array);
    await expect(loadRegistry()).resolves.toBeDefined();
  });

  it('registers subscribers', async () => {
    const ctx = createTestContext();
    const names = await loadSubscribers(ctx.bus, fixture('subscribers'));
    expect(names).toHaveLength(1);
    expect(ctx.bus.emit({ type: 'level_up', userId: 'u', level: 2 }, ctx)).toEqual([{ userId: 'u', text: 'fixture:2' }]);
  });
});

describe('scheduler', () => {
  it('runs due jobs by interval and isolates failures', async () => {
    const ctx = createTestContext();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const jobs = await loadJobs(fixture('jobs'));
    expect(jobs.map((j) => j.name).sort()).toEqual(['broken', 'ok']);
    const last = new Map<string, number>();
    const t0 = ctx.clock.now();
    expect(await runDueJobs(ctx, jobs, last, t0)).toEqual(['ok']); // broken failed but did not stop 'ok'
    expect(await runDueJobs(ctx, jobs, last, t0 + 60_000)).toEqual([]); // ok not due (5 min), broken fails again
    expect(await runDueJobs(ctx, jobs, last, t0 + 5 * 60_000)).toEqual(['ok']);
    vi.restoreAllMocks();
  });
});

describe('registry', () => {
  it('loads commands and components from a dir', async () => {
    const reg = await loadRegistry(fixture('commands'));
    expect([...reg.commands.keys()]).toEqual(['ping']);
    expect([...reg.components.keys()]).toEqual(['ping']);
    expect(commandsJson(reg)[0]!.name).toBe('ping');
  });

  it('throws on duplicate names/prefixes', async () => {
    const reg = await loadRegistry(fixture('commands'));
    const mod = await import('../fixtures/commands/ping.js');
    expect(() => registerModule(reg, mod, 'dup')).toThrow(/Duplicate/);
    const reg2 = createRegistry();
    expect(() => registerModule(reg2, { components: [{ prefix: 'x', handle: async () => {} }, { prefix: 'x', handle: async () => {} }] })).toThrow(
      /Duplicate component prefix/,
    );
  });

  it('parses customIds', () => {
    expect(parseCustomId('fish:hook:123')).toEqual(['fish', ['hook', '123']]);
    expect(parseCustomId('solo')).toEqual(['solo', []]);
  });
});
