// /challenges — daily, weekly and seasonal challenges with progress bars, rewards and time until reset.
import { SlashCommandBuilder } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import { nextDayReset, nextWeekReset } from '../../core/time.js';
import type { ChallengeScope } from '../../data/types.js';
import { formatReward } from '../../services/rewards.js';
import { dailyBonusClaimed, listChallenges, type ChallengeView } from '../../services/challenges.js';
import { getOrCreatePlayer } from '../../services/player.js';
import { ensureActiveSeason } from '../../services/season.js';
import type { Command } from '../types.js';
import { COLORS, formatDuration, formatNumber, makeEmbed, progressBar } from '../ui.js';

const SECTION_TITLES: Record<ChallengeScope, string> = {
  daily: '📅 Ежедневные',
  weekly: '🗓️ Еженедельные',
  seasonal: '🏆 Сезонные',
};

const FIELD_LIMIT = 1024;

function line(c: ChallengeView): string {
  const progress = Math.min(c.target, Math.floor(c.progress));
  const head = c.completed ? `✅ ~~${c.title}~~` : `▫️ **${c.title}**`;
  const pass = c.passXp > 0 ? ` · 🎫 ${c.passXp}` : '';
  return `${head}\n${progressBar(progress, c.target, 10)} ${formatNumber(progress)}/${formatNumber(c.target)} · ${formatReward(c.reward)}${pass}`;
}

/** Splits lines into chunks that fit an embed field value. */
function chunk(lines: string[]): string[] {
  const out: string[] = [];
  let cur = '';
  for (const l of lines) {
    const next = cur ? `${cur}\n${l}` : l;
    if (next.length > FIELD_LIMIT && cur) {
      out.push(cur);
      cur = l.slice(0, FIELD_LIMIT);
    } else cur = next.slice(0, FIELD_LIMIT);
  }
  if (cur) out.push(cur);
  return out;
}

const command: Command = {
  data: new SlashCommandBuilder().setName('challenges').setDescription('Ежедневные, еженедельные и сезонные испытания'),
  async execute(i, ctx) {
    getOrCreatePlayer(ctx, i.user.id, i.user.username);
    const list = listChallenges(ctx, i.user.id);
    const now = ctx.clock.now();
    const tz = ctx.config.timezone;
    const season = ensureActiveSeason(ctx);
    const resets: Record<ChallengeScope, number> = { daily: nextDayReset(now, tz), weekly: nextWeekReset(now, tz), seasonal: season.endsAt };

    const embed = makeEmbed({ title: '🎯 Испытания', color: COLORS.primary });
    const dailies = list.filter((c) => c.scope === 'daily');
    const dailyDone = dailies.filter((c) => c.completed).length;
    const bonus = dailyBonusClaimed(ctx, i.user.id)
      ? `🌟 Бонус за все ежедневные получен`
      : `🌟 Выполни все ежедневные (${dailyDone}/${dailies.length}) — бонус 🐚 ${BALANCE.challenges.allDailyBonusPearls}`;
    embed.setDescription(bonus);

    for (const scope of ['daily', 'weekly', 'seasonal'] as const) {
      const items = list.filter((c) => c.scope === scope);
      const done = items.filter((c) => c.completed).length;
      const header = `${SECTION_TITLES[scope]} (${done}/${items.length}) · сброс через ${formatDuration(resets[scope] - now)}`;
      const parts = chunk(items.length > 0 ? items.map(line) : ['— нет испытаний —']);
      parts.forEach((value, idx) => embed.addFields({ name: idx === 0 ? header : `${SECTION_TITLES[scope]} (продолжение)`, value }));
    }
    embed.setFooter({ text: 'Награды выдаются автоматически при выполнении' });
    await i.reply({ embeds: [embed] });
  },
};

export default command;
