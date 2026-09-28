// Auto-loads commands & component handlers from src/discord/commands/ (tsx .ts or compiled .js).
import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { loadModules } from '../core/loader.js';
import type { Command, CommandModule, ComponentHandler } from './types.js';

export interface Registry {
  commands: Map<string, Command>;
  components: Map<string, ComponentHandler>;
}

export const COMMANDS_DIR = new URL('./commands/', import.meta.url);

export function createRegistry(): Registry {
  return { commands: new Map(), components: new Map() };
}

/** Adds a command module to the registry. Throws on duplicate command name or component prefix. */
export function registerModule(reg: Registry, mod: CommandModule, source = '<inline>'): void {
  const cmd = mod.default;
  if (cmd) {
    if (!cmd.data || typeof cmd.execute !== 'function') throw new Error(`Invalid command export in ${source}`);
    const name = cmd.data.name;
    if (reg.commands.has(name)) throw new Error(`Duplicate command name '/${name}' (${source})`);
    reg.commands.set(name, cmd);
  }
  for (const h of mod.components ?? []) {
    if (!h.prefix || h.prefix.includes(':')) throw new Error(`Invalid component prefix '${h.prefix}' (${source})`);
    if (reg.components.has(h.prefix)) throw new Error(`Duplicate component prefix '${h.prefix}' (${source})`);
    reg.components.set(h.prefix, h);
  }
  if (!cmd && !(mod.components?.length)) console.warn(`[registry] ${source} exports neither a command nor components — skipped`);
}

export async function loadRegistry(dir: string | URL = COMMANDS_DIR): Promise<Registry> {
  const reg = createRegistry();
  for (const { file, module } of await loadModules<CommandModule>(dir)) registerModule(reg, module, file);
  return reg;
}

export function commandsJson(reg: Registry): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return [...reg.commands.values()].map((c) => c.data.toJSON());
}

/** PUTs all slash commands to the guild (instant update). Returns the number registered. */
export async function registerGuildCommands(token: string, clientId: string, guildId: string, reg: Registry): Promise<number> {
  const rest = new REST({ version: '10' }).setToken(token);
  const body = commandsJson(reg);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  return body.length;
}
