import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import challenges from '../../src/discord/commands/challenges.js';
import pass from '../../src/discord/commands/pass.js';
import season from '../../src/discord/commands/season.js';
import { createRegistry, registerModule } from '../../src/discord/registry.js';
import { registerPassXpHandler } from '../../src/services/rewards.js';
import { addPassXp } from '../../src/services/season.js';
import { createTestContext } from '../helpers.js';

afterEach(() => registerPassXpHandler(null));

function fakeInteraction() {
  const reply = vi.fn(async (_opts: { embeds: EmbedBuilder[] }) => undefined);
  const i = { user: { id: 'u1', username: 'Тестер' }, reply } as unknown as ChatInputCommandInteraction;
  return { i, reply };
}

describe('WP3 commands', () => {
  it('register with unique names and valid JSON', () => {
    const reg = createRegistry();
    for (const c of [challenges, pass, season]) registerModule(reg, { default: c });
    expect([...reg.commands.keys()].sort()).toEqual(['challenges', 'pass', 'season']);
    for (const c of reg.commands.values()) expect(c.data.toJSON().description.length).toBeGreaterThan(0);
  });

  it.each([
    ['challenges', challenges],
    ['pass', pass],
    ['season', season],
  ] as const)('/%s replies with an embed within Discord limits', async (_name, cmd) => {
    const ctx = createTestContext();
    addPassXp(ctx, 'u1', 450);
    const { i, reply } = fakeInteraction();
    await cmd.execute(i, ctx);
    expect(reply).toHaveBeenCalledOnce();
    const embed = reply.mock.calls[0]![0].embeds[0]!.toJSON();
    expect(embed.title).toBeTruthy();
    const total = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
    expect(total).toBeLessThanOrEqual(6000);
    for (const f of embed.fields ?? []) expect(f.value.length).toBeLessThanOrEqual(1024);
  });
});
