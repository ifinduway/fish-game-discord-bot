import { describe, expect, it } from 'vitest';
import boss from '../../src/discord/commands/boss.js';
import profile from '../../src/discord/commands/profile.js';
import server from '../../src/discord/commands/server.js';
import stats from '../../src/discord/commands/stats.js';
import top from '../../src/discord/commands/top.js';
import { LEADERBOARD_CATEGORIES } from '../../src/game/leaderboard.js';

describe('WP4 slash command definitions', () => {
  it('serialize with unique names and all 8 /top choices', () => {
    const cmds = [boss, top, server, profile, stats].map((c) => c.data.toJSON());
    expect(cmds.map((c) => c.name)).toEqual(['boss', 'top', 'server', 'profile', 'stats']);
    const opt = cmds[1]!.options![0] as { choices?: { value: string }[] };
    expect(opt.choices!.map((c) => c.value)).toEqual(LEADERBOARD_CATEGORIES.map((c) => c.id));
  });
});
