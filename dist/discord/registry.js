// Auto-loads commands & component handlers from src/discord/commands/ (tsx .ts or compiled .js).
import { REST, Routes } from 'discord.js';
import { loadModules } from '../core/loader.js';
export const COMMANDS_DIR = new URL('./commands/', import.meta.url);
export function createRegistry() {
    return { commands: new Map(), components: new Map() };
}
/** Adds a command module to the registry. Throws on duplicate command name or component prefix. */
export function registerModule(reg, mod, source = '<inline>') {
    const cmd = mod.default;
    if (cmd) {
        if (!cmd.data || typeof cmd.execute !== 'function')
            throw new Error(`Invalid command export in ${source}`);
        const name = cmd.data.name;
        if (reg.commands.has(name))
            throw new Error(`Duplicate command name '/${name}' (${source})`);
        reg.commands.set(name, cmd);
    }
    for (const h of mod.components ?? []) {
        if (!h.prefix || h.prefix.includes(':'))
            throw new Error(`Invalid component prefix '${h.prefix}' (${source})`);
        if (reg.components.has(h.prefix))
            throw new Error(`Duplicate component prefix '${h.prefix}' (${source})`);
        reg.components.set(h.prefix, h);
    }
    if (!cmd && !(mod.components?.length))
        console.warn(`[registry] ${source} exports neither a command nor components — skipped`);
}
export async function loadRegistry(dir = COMMANDS_DIR) {
    const reg = createRegistry();
    for (const { file, module } of await loadModules(dir))
        registerModule(reg, module, file);
    return reg;
}
export function commandsJson(reg) {
    return [...reg.commands.values()].map((c) => c.data.toJSON());
}
/** PUTs all slash commands to the guild (instant update). Returns the number registered. */
export async function registerGuildCommands(token, clientId, guildId, reg) {
    const rest = new REST({ version: '10' }).setToken(token);
    const body = commandsJson(reg);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    return body.length;
}
//# sourceMappingURL=registry.js.map