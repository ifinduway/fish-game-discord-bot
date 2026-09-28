// Announcement helpers (amendment §8.2). WP0 owns the base; WP4 may APPEND more functions.
// All helpers are fire-and-forget safe: they never throw and are no-ops when ctx.announce is not injected.
// Note: announceCatch renders the catch card itself when no image is supplied (the only render call outside discord/).
import type { AnnouncePayload, GameContext } from '../core/context.js';
import { RARITY_INFO } from '../data/types.js';
import { renderCatchCard, type CatchCardData } from '../render/index.js';

export interface CatchAnnounceData {
  userId: string;
  card: CatchCardData;
  /** already rendered catch card PNG (skips re-rendering) */
  image?: Buffer;
}

async function send(ctx: GameContext, payload: AnnouncePayload): Promise<void> {
  if (!ctx.announce) return;
  try {
    await ctx.announce(payload);
  } catch (err) {
    console.error('[announce] failed:', err);
  }
}

export async function announceCatch(ctx: GameContext, data: CatchAnnounceData): Promise<void> {
  if (!ctx.announce) return;
  const { card } = data;
  const info = RARITY_INFO[card.species.rarity];
  let image = data.image;
  if (!image) {
    try {
      image = await renderCatchCard(card);
    } catch (err) {
      console.error('[announce] catch card render failed:', err);
    }
  }
  const extras = [card.perfect ? '🎯 идеальная подсечка' : null, card.firstOfSpecies ? '🆕 первый улов вида' : null, card.record ? '🏆 рекорд сервера' : null]
    .filter(Boolean)
    .join(' · ');
  await send(ctx, {
    title: `${info.emoji} ${info.name} рыба поймана!`,
    description: `<@${data.userId}> поймал(а) **${card.species.emoji ?? '🐟'} ${card.species.name}** — ${card.weight} кг, ${'★'.repeat(card.quality)} (${card.location})${extras ? `\n${extras}` : ''}`,
    color: info.color,
    file: image ? { name: 'catch.png', data: image } : undefined,
  });
}

export async function announceText(
  ctx: GameContext,
  title: string,
  text: string,
  color?: number,
  file?: { name: string; data: Buffer },
): Promise<void> {
  await send(ctx, { title, description: text, color, file });
}

// ───────────────────────── WP4 additions (social) ─────────────────────────
import { renderBossCard, renderLeaderboardCard, type BossCardData, type LeaderboardCardData } from '../render/index.js';

/** Announcement with an optional rendered card; render failures degrade to a text-only announcement. */
async function sendWithCard(
  ctx: GameContext,
  payload: Omit<AnnouncePayload, 'file'>,
  fileName: string,
  render: () => Promise<Buffer>,
): Promise<void> {
  if (!ctx.announce) return;
  let data: Buffer | undefined;
  try {
    data = await render();
  } catch (err) {
    console.error(`[announce] ${fileName} render failed:`, err);
  }
  await send(ctx, { ...payload, file: data ? { name: fileName, data } : undefined });
}

/** Boss spawn / defeat / expiry announcement with the boss HP card. */
export async function announceBoss(ctx: GameContext, payload: Omit<AnnouncePayload, 'file'>, card: BossCardData): Promise<void> {
  await sendWithCard(ctx, payload, 'boss.png', () => renderBossCard(card));
}

/** Announcement with a leaderboard card (weekly results, tournament results). */
export async function announceLeaderboard(ctx: GameContext, payload: Omit<AnnouncePayload, 'file'>, card: LeaderboardCardData): Promise<void> {
  await sendWithCard(ctx, payload, 'top.png', () => renderLeaderboardCard(card));
}

/** Plain embed announcement with fields (server goal, events). */
export async function announcePayload(ctx: GameContext, payload: AnnouncePayload): Promise<void> {
  await send(ctx, payload);
}
