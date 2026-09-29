// Bootstrap (plan §6 WP0): env → DB → migrate → ctx → subscribers → client → registry → ready (register commands, scheduler) → routing.
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { loadEnv } from './config/env.js';
import { createContext } from './core/context.js';
import { loadSubscribers } from './core/loader.js';
import { openDatabase } from './db/database.js';
import { createAnnouncer } from './discord/announcer.js';
import { loadRegistry, registerGuildCommands } from './discord/registry.js';
import { createInteractionHandler } from './discord/router.js';
import { loadJobs, startScheduler, type SchedulerHandle } from './scheduler/index.js';

async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DISCORD_TOKEN) {
    console.error('DISCORD_TOKEN не задан — скопируйте .env.example в .env');
    process.exit(1);
  }

  const db = openDatabase(env.DB_PATH);
  const ctx = createContext({ db, defaultTimezone: env.TZ_DEFAULT });
  const subscribers = await loadSubscribers(ctx.bus);
  console.log(`[boot] subscribers: ${subscribers.length}`);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  ctx.announce = createAnnouncer(client, ctx);

  const registry = await loadRegistry();
  console.log(`[boot] commands: ${registry.commands.size}, component handlers: ${registry.components.size}`);
  const jobs = await loadJobs();
  let scheduler: SchedulerHandle | null = null;

  const register = async (clientId: string, guildId: string): Promise<void> => {
    try {
      const n = await registerGuildCommands(env.DISCORD_TOKEN!, clientId, guildId, registry);
      console.log(`[boot] registered ${n} slash commands in guild ${guildId}`);
    } catch (err) {
      console.error(`[boot] failed to register slash commands in guild ${guildId}:`, err);
    }
  };

  client.once(Events.ClientReady, async (c) => {
    console.log(`[boot] logged in as ${c.user.tag}`);
    const clientId = env.CLIENT_ID ?? c.application.id;
    if (env.GUILD_ID) {
      await register(clientId, env.GUILD_ID);
    } else {
      // No GUILD_ID: register on every guild the bot is in, and on guilds it joins later.
      console.warn(`[boot] GUILD_ID не задан — регистрирую команды на всех серверах бота (${c.guilds.cache.size})`);
      for (const guildId of c.guilds.cache.keys()) await register(clientId, guildId);
      client.on(Events.GuildCreate, (guild) => void register(clientId, guild.id));
    }
    scheduler = startScheduler(ctx, jobs);
    console.log(`[boot] scheduler started with ${jobs.length} jobs`);
  });

  client.on(Events.InteractionCreate, createInteractionHandler(registry, ctx));
  client.on(Events.Error, (err) => console.error('[discord] client error:', err));

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[boot] ${signal} — shutting down`);
    scheduler?.stop();
    await client.destroy().catch(() => undefined);
    db.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await client.login(env.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error('[boot] fatal:', err);
  process.exit(1);
});
