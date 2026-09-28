// Shared UI helpers for WP2 commands (underscore → not auto-loaded as a command).
import type { EmbedBuilder } from 'discord.js';
import type { Notice } from '../../core/events.js';
import { FISH_BY_ID } from '../../data/fish.js';
import { LOCATION_BY_ID } from '../../data/locations.js';
import type { GearSlot, LocationId } from '../../data/types.js';
import type { CaughtFishRow } from '../../db/repos/inventory.js';
import { formatCoins, formatWeight, rarityEmoji, stars } from '../ui.js';

/** Appends notices (challenge completions, level-ups…) as a field. */
export function addNotices(embed: EmbedBuilder, notices: readonly Notice[]): EmbedBuilder {
  if (notices.length === 0) return embed;
  let text = notices.map((n) => n.text).join('\n');
  if (text.length > 1024) text = `${text.slice(0, 1020)}…`;
  embed.addFields({ name: '📣 События', value: text });
  return embed;
}

export function locationLabel(id: LocationId | string): string {
  const l = LOCATION_BY_ID[id as LocationId];
  return l ? `${l.emoji} ${l.name}` : String(id);
}

/** One-line description of a caught fish. */
export function fishLine(f: CaughtFishRow): string {
  const s = FISH_BY_ID[f.species_id];
  const name = s ? `${s.emoji} ${s.name}` : `🐟 ${f.species_id}`;
  const rar = s ? rarityEmoji(s.rarity) : '⚪';
  return `${rar} ${name} — ${formatWeight(f.weight)} ${stars(f.quality)} — ${formatCoins(f.value)}${f.staked ? ' 🃏' : ''}`;
}

/** Plain (no markdown) label for autocomplete (≤ 100 chars). */
export function fishChoiceLabel(f: CaughtFishRow): string {
  const s = FISH_BY_ID[f.species_id];
  const label = `${s ? s.name : f.species_id} — ${f.weight} кг ★${f.quality} — ${f.value} мон. (#${f.id})`;
  return label.length > 100 ? label.slice(0, 100) : label;
}

export function clip(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export const SLOT_NAMES: Record<GearSlot, string> = { rod: '🎣 Удочка', reel: '⚙️ Катушка', line: '🧵 Леска', outfit: '🧥 Экипировка' };
