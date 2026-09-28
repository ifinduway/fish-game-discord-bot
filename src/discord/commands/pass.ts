// /pass — season pass: level, XP bar, upcoming rewards (auto-granted on level-up).
import { SlashCommandBuilder } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import { PASS_REWARDS } from '../../data/pass.js';
import { SEASON_THEME_BY_ID } from '../../data/seasons.js';
import { getOrCreatePlayer } from '../../services/player.js';
import { formatReward } from '../../services/rewards.js';
import { ensureActiveSeason, getPassProgress } from '../../services/season.js';
import type { Command } from '../types.js';
import { COLORS, formatDuration, formatNumber, makeEmbed, progressBar } from '../ui.js';

const SHOW_NEXT = 5;

const command: Command = {
  data: new SlashCommandBuilder().setName('pass').setDescription('Сезонный пасс: уровень, опыт и награды'),
  async execute(i, ctx) {
    const userId = i.user.id;
    getOrCreatePlayer(ctx, userId, i.user.username);
    const season = ensureActiveSeason(ctx);
    const theme = SEASON_THEME_BY_ID[season.themeId];
    const p = getPassProgress(ctx, userId, season.id)!;
    const maxed = p.level >= p.maxLevel;

    const bar = maxed
      ? `${progressBar(1, 1, 12)} **MAX**`
      : `${progressBar(p.xpIntoLevel, p.xpToNext, 12)} ${formatNumber(p.xpIntoLevel)}/${formatNumber(p.xpToNext)} XP`;
    const px = BALANCE.passXp;
    const embed = makeEmbed({
      title: `🎫 Сезонный пасс — ${season.name}`,
      description: [
        `Уровень: **${p.level}**/${p.maxLevel} · всего опыта: **${formatNumber(p.xp)} XP**`,
        bar,
        `⏳ До конца сезона: ${formatDuration(season.endsAt - ctx.clock.now())}`,
      ].join('\n'),
      color: theme ? Number.parseInt(theme.colors[0].replace('#', ''), 16) || COLORS.primary : COLORS.primary,
    });

    const from = Math.max(1, p.level - 1);
    const to = Math.min(p.maxLevel, p.level + SHOW_NEXT);
    const rows: string[] = [];
    for (let level = from; level <= to; level++) {
      const entry = PASS_REWARDS.find((r) => r.level === level);
      const mark = level <= p.level ? '✅' : '🔒';
      rows.push(`${mark} **${level}** — ${entry ? formatReward(entry.reward) : '—'}`);
    }
    embed.addFields({ name: maxed ? 'Награды (все получены)' : 'Награды', value: rows.join('\n') || '—' });
    embed.addFields({
      name: 'Как получить опыт',
      value: [
        `🎣 Заброс: +${px.cast} · 🐟 Улов: +${px.catchByRarity.common}…${px.catchByRarity.mythic}`,
        `🎯 Испытания: +${px.dailyChallenge} / +${px.weeklyChallenge} / +${px.seasonalChallenge}`,
        `⚔️ Участие в боссе: +${px.bossParticipation}`,
      ].join('\n'),
    });
    embed.setFooter({ text: 'Награды уровней выдаются автоматически' });
    await i.reply({ embeds: [embed] });
  },
};

export default command;
