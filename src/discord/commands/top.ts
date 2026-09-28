// /top <category> — leaderboards (8 categories) as a PNG card + the requester's rank.
import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { LEADERBOARD_CATEGORIES, formatRankLine, isLeaderboardCategory } from '../../game/leaderboard.js';
import { renderLeaderboardCard } from '../../render/index.js';
import { getLeaderboard } from '../../services/leaderboard.js';
import type { Command } from '../types.js';
import { COLORS, makeEmbed, replyEphemeral } from '../ui.js';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('top')
    .setDescription('Рейтинги игроков')
    .addStringOption((o) =>
      o
        .setName('category')
        .setDescription('Категория рейтинга')
        .setRequired(true)
        .addChoices(...LEADERBOARD_CATEGORIES.map((c) => ({ name: `${c.emoji} ${c.title}`, value: c.id }))),
    ),
  async execute(i, ctx) {
    const category = i.options.getString('category', true);
    if (!isLeaderboardCategory(category)) {
      await replyEphemeral(i, 'Неизвестная категория рейтинга.');
      return;
    }
    await i.deferReply();
    const board = getLeaderboard(ctx, category, { userId: i.user.id });
    const embed = makeEmbed({
      title: board.title,
      description: [board.subtitle, '', formatRankLine(board.me ? { rank: board.me.rank, value: board.me.display } : null)].join('\n'),
      color: COLORS.warning,
    });
    if (board.def.weekly) embed.setFooter({ text: 'Недельный рейтинг сбрасывается в понедельник 00:00 — победитель получает жемчуг 🐚' });
    if (board.rows.length === 0) {
      embed.setDescription(`${board.subtitle}\n\nРейтинг пока пуст — стань первым! 🎣`);
      await i.editReply({ embeds: [embed] });
      return;
    }
    const files: AttachmentBuilder[] = [];
    try {
      const png = await renderLeaderboardCard({
        title: board.title,
        subtitle: board.subtitle,
        rows: board.rows.map((r) => ({ rank: r.rank, username: r.username, value: r.display, userId: r.userId })),
        highlightUserId: i.user.id,
      });
      files.push(new AttachmentBuilder(png, { name: 'top.png' }));
      embed.setImage('attachment://top.png');
    } catch (err) {
      console.error('[top] render failed:', err);
      embed.addFields({ name: 'Топ', value: board.rows.map((r) => `#${r.rank} ${r.username} — ${r.display}`).join('\n') });
    }
    await i.editReply({ embeds: [embed], files });
  },
};

export default command;
