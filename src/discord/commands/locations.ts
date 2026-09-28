// /locations — unlock status and species progress per location.
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { GameContext } from '../../core/context.js';
import { TIME_OF_DAY_NAMES, timeOfDay } from '../../core/time.js';
import { locationsOverview } from '../../services/collection.js';
import { ensurePlayerReady } from '../../services/player-state.js';
import type { Command } from '../types.js';
import { COLORS, makeEmbed } from '../ui.js';

const data = new SlashCommandBuilder().setName('locations').setDescription('Локации для рыбалки 🗺️');

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const p = ensurePlayerReady(ctx, i.user.id, i.user.username);
  const lines = locationsOverview(ctx, i.user.id).map((o) => {
    const l = o.location;
    const status = o.unlocked ? '✅' : `🔒 с ${l.unlockLevel} ур.`;
    return `${l.emoji} **${l.name}** ${status}${o.current ? ' · 📍 здесь' : ''}\nВидов поймано: ${o.caught}/${o.total} · ${l.description}`;
  });
  const embed = makeEmbed({
    title: '🗺️ Локации',
    description: lines.join('\n\n'),
    color: COLORS.water,
    footer: `Твой уровень: ${p.level} · сейчас ${TIME_OF_DAY_NAMES[timeOfDay(ctx.clock.now(), ctx.config.timezone)].toLowerCase()} · /fish location — сменить`,
  });
  await i.reply({ embeds: [embed] });
}

const command: Command = { data, execute };
export default command;
