import type { DB } from '../db/database.js';
import { getConfig, CONFIG_KEYS } from '../db/repos/config.js';
import { DEFAULT_TIMEZONE } from '../config/env.js';
import { systemClock, type Clock } from './clock.js';
import { EventBus } from './events.js';
import { defaultRng, type Rng } from './rng.js';

/** Plain (discord-free) announcement. The discord layer turns it into an embed in the announce channel. */
export interface AnnouncePayload {
  title: string;
  description?: string;
  /** embed color (e.g. RARITY_INFO[r].color) */
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: string;
  /** optional PNG shown as the embed image */
  file?: { name: string; data: Buffer };
  /** optional plain message content (e.g. mentions) */
  content?: string;
}

export interface GameConfig {
  /** live-read from guild_config `timezone`, fallback env TZ_DEFAULT, fallback Europe/Moscow */
  readonly timezone: string;
  /** live-read from guild_config `announce_channel_id` */
  readonly announceChannelId: string | null;
}

export interface GameContext {
  db: DB;
  rng: Rng;
  clock: Clock;
  bus: EventBus;
  config: GameConfig;
  /** injected by the discord layer; services call `ctx.announce?.(...)` */
  announce?: (payload: AnnouncePayload) => Promise<void>;
}

export interface CreateContextOptions {
  db: DB;
  rng?: Rng;
  clock?: Clock;
  bus?: EventBus;
  /** fallback timezone when guild_config has none (env TZ_DEFAULT) */
  defaultTimezone?: string;
  announce?: (payload: AnnouncePayload) => Promise<void>;
}

export function createContext(opts: CreateContextOptions): GameContext {
  const { db } = opts;
  const fallbackTz = opts.defaultTimezone ?? DEFAULT_TIMEZONE;
  const config: GameConfig = {
    get timezone() {
      return getConfig({ db }, CONFIG_KEYS.timezone) ?? fallbackTz;
    },
    get announceChannelId() {
      return getConfig({ db }, CONFIG_KEYS.announceChannelId);
    },
  };
  return {
    db,
    rng: opts.rng ?? defaultRng,
    clock: opts.clock ?? systemClock,
    bus: opts.bus ?? new EventBus(),
    config,
    announce: opts.announce,
  };
}
