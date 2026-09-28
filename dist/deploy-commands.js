// Registers all slash commands on GUILD_ID (yarn deploy). The bot also does this on startup.
import { loadEnv } from './config/env.js';
import { loadRegistry, registerGuildCommands } from './discord/registry.js';
async function main() {
    const env = loadEnv();
    const missing = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'].filter((k) => !env[k]);
    if (missing.length > 0) {
        console.error(`Не заданы переменные: ${missing.join(', ')} — скопируйте .env.example в .env`);
        process.exit(1);
    }
    const registry = await loadRegistry();
    const n = await registerGuildCommands(env.DISCORD_TOKEN, env.CLIENT_ID, env.GUILD_ID, registry);
    console.log(`Зарегистрировано команд: ${n}`);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=deploy-commands.js.map