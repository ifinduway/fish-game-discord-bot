import { describe, expect, it } from 'vitest';
import { commandsJson, createRegistry, registerModule } from '../../src/discord/registry.js';
import * as blackjack from '../../src/discord/commands/blackjack.js';
import * as chest from '../../src/discord/commands/chest.js';

describe('WP5 command modules', () => {
  it('register and serialize (/chest, /blackjack, component prefixes)', () => {
    const reg = createRegistry();
    registerModule(reg, chest, 'chest');
    registerModule(reg, blackjack, 'blackjack');
    const json = commandsJson(reg);
    expect(json.map((c) => c.name).sort()).toEqual(['blackjack', 'chest']);
    const byName = Object.fromEntries(json.map((c) => [c.name, (c.options ?? []).map((o) => o.name).sort()]));
    expect(byName.chest).toEqual(['info', 'open']);
    expect(byName.blackjack).toEqual(['coins', 'fish']);
    expect([...reg.components.keys()].sort()).toEqual(['bj', 'bjf']);
  });
});
