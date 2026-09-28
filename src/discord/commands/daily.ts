// /daily — daily login pearls with streak.
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { claimDaily } from '../../services/economy.js';
import type { Command } from '../types.js';
import { COLORS, formatPearls, makeEmbed, plural, relativeTime, replyEphemeral } from '../ui.js';
import { addNotices } from './_wp2-ui.js';

const data = new SlashCommandBuilder().setName('daily').setDescription('Ежедневная награда 🐚');

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const res = claimDaily(ctx, i.user.id, i.user.username);
  if (!res.ok) {
    return replyEphemeral(i, `Сегодня награда уже получена ✅ Серия: ${res.streak} ${plural(res.streak, 'день', 'дня', 'дней')}. Следующая — ${relativeTime(res.nextResetAt)}.`);
  }
  const d = BALANCE.daily;
  const embed = makeEmbed({
    title: '🎁 Ежедневная награда',
    description: `+**${formatPearls(res.pearls)}**\nСерия: **${res.streak}** ${plural(res.streak, 'день', 'дня', 'дней')} 🔥${
      res.pearls < d.maxPearls ? `\nЗавтра: ${formatPearls(Math.min(d.maxPearls, res.pearls + d.perStreakDay))}` : ''
    }\nНе пропускай дни — пропуск сбрасывает серию.`,
    color: COLORS.success,
    footer: 'Жемчуг тратится на сундуки: /chest',
  });
  await i.reply({ embeds: [addNotices(embed, res.notices)] });
}

const command: Command = { data, execute };
export default command;
