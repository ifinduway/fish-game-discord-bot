import dotenv from 'dotenv';

export interface Env {
  DISCORD_TOKEN: string | undefined;
  CLIENT_ID: string | undefined;
  GUILD_ID: string | undefined;
  DB_PATH: string;
  TZ_DEFAULT: string;
}

export const DEFAULT_TIMEZONE = 'Europe/Moscow';
export const DEFAULT_DB_PATH = 'data/fishing.db';

function clean(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

/** Loads `.env` (if present) and returns parsed settings. Never throws; callers validate what they need. */
export function loadEnv(): Env {
  dotenv.config({ quiet: true });
  return {
    DISCORD_TOKEN: clean(process.env.DISCORD_TOKEN),
    CLIENT_ID: clean(process.env.CLIENT_ID),
    GUILD_ID: clean(process.env.GUILD_ID),
    DB_PATH: clean(process.env.DB_PATH) ?? DEFAULT_DB_PATH,
    TZ_DEFAULT: clean(process.env.TZ_DEFAULT) ?? DEFAULT_TIMEZONE,
  };
}
