// /season — current season: theme, time left, your season stats and top-3 per season category.
import { SlashCommandBuilder } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import { SEASON_THEME_BY_ID } from '../../data/seasons.js';
import * as stats from '../../db/repos/stats.js';
import { getOrCreatePlayer } from '../../services/player.js';
import {
  ensureActiveSeason,
  formatCategoryValue,
  getPassProgress,
  getSeasonLeaders,
  getSeasonStanding,
  SEASON_CATEGORIES,
} from '../../services/season.js';
import type { Command } from '../types.js';
import { COLORS, formatDuration, formatNumber, formatWeight, makeEmbed } from '../ui.js';

const MEDALS = ['🥇', '🥈', '🥉'];

function hexToInt(hex: string | undefined): number {
  const n = hex ? Number.parseInt(hex.replace('#', ''), 16) : NaN;
  return Number.isFinite(n) ? n : COLORS.primary;
}

const command: Command = {
  data: new SlashCommandBuilder().setName('season').setDescription('Текущий сезон, твоя сезонная статистика и лидеры'),
  async execute(i, ctx) {
    const userId = i.user.id;
    getOrCreatePlayer(ctx, userId, i.user.username);
    const season = ensureActiveSeason(ctx);
    const theme = SEASON_THEME_BY_ID[season.themeId];
    const now = ctx.clock.now();
    const scope = stats.scopeSeason(season.id);
    const my = stats.getAll(ctx, userId, scope);
    const pass = getPassProgress(ctx, userId, season.id);

    const embed = makeEmbed({
      title: `${theme?.emoji ?? '🌊'} ${season.name}`,
      description: [
        `Тема: **${theme?.name ?? season.themeId}**`,
        `⏳ До конца сезона: **${formatDuration(season.endsAt - now)}**`,
        `Топ-${BALANCE.season.topPlaces} каждой категории получают постоянный титул и значок сезона.`,
      ].join('\n'),
      color: hexToInt(theme?.colors[0]),
    });

    const standings = SEASON_CATEGORIES.map((c) => {
      const s = getSeasonStanding(ctx, userId, season.id, c.id);
      return `${c.title}: **${formatCategoryValue(c.id, s.value)}**${s.rank ? ` (#${s.rank})` : ''}`;
    });
    embed.addFields({
      name: '📊 Твой сезон',
      value: [
        `🎫 Пасс: ур. **${pass?.level ?? 0}**/${pass?.maxLevel ?? BALANCE.pass.levels}`,
        `🎣 Забросов: **${formatNumber(my.casts ?? 0)}** · 🐟 Поймано: **${formatNumber(my.catches ?? 0)}**`,
        `🔵 Редких+: **${formatNumber(my.rare_plus ?? 0)}** · 🏋️ Рекорд: **${formatWeight(my.heaviest_weight ?? 0)}**`,
        ...standings,
      ].join('\n'),
    });

    for (const cat of getSeasonLeaders(ctx, season.id)) {
      const value =
        cat.winners.length > 0
          ? cat.winners.map((w, idx) => `${MEDALS[idx] ?? `${idx + 1}.`} <@${w.userId}> — ${formatCategoryValue(cat.id, w.value)}`).join('\n')
          : '— пока никого —';
      embed.addFields({ name: cat.title, value, inline: true });
    }
    embed.setFooter({ text: `Итоги подводятся автоматически в конце сезона` });
    await i.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

export default command;
