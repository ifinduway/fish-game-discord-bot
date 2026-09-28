// /server — server totals, weekly goal, species records, bosses, active events, active players, rarest catch.
import { SlashCommandBuilder } from 'discord.js';
import { RARITY_INFO } from '../../data/types.js';
import { bossDef, getActiveBoss } from '../../services/boss.js';
import { getServerOverview } from '../../services/server.js';
import { describeServerEvent } from '../../services/server-events.js';
import type { Command } from '../types.js';
import { COLORS, formatNumber, formatPercent, formatWeight, makeEmbed, progressBar } from '../ui.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('server').setDescription('Статистика сервера, рекорды и цель недели'),
  async execute(i, ctx) {
    const o = getServerOverview(ctx);
    const g = o.goal;
    const goalUnit = g.metric === 'total_weight' ? ' кг' : '';
    const goalLine = [
      `${progressBar(g.progress, g.target, 14)} ${formatPercent(Math.min(1, g.target > 0 ? g.progress / g.target : 0))}`,
      `**${formatNumber(g.progress)}**/${formatNumber(g.target)}${goalUnit}${g.completed_at ? ' — ✅ выполнена!' : ''}`,
    ].join('\n');
    const boss = getActiveBoss(ctx);

    const embed = makeEmbed({ title: '🌊 Сервер «Рыбалка»', color: COLORS.water });
    embed.addFields(
      {
        name: '📊 За всё время',
        value: [
          `🐟 Поймано рыб: **${formatNumber(o.totals.catches)}**`,
          `⚖️ Общий вес: **${formatWeight(o.totals.totalWeight)}**`,
          `🎣 Забросов: **${formatNumber(o.totals.casts)}**`,
          `⚔️ Побеждено боссов: **${formatNumber(o.totals.bossesDefeated)}**`,
          `👥 Игроков: **${formatNumber(o.players)}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: `📅 Эта неделя (${o.week.key})`,
        value: [
          `🐟 Рыб: **${formatNumber(o.week.catches)}**`,
          `⚖️ Вес: **${formatWeight(o.week.totalWeight)}**`,
          `🔥 Активных игроков: **${formatNumber(o.week.activePlayers)}**`,
        ].join('\n'),
        inline: true,
      },
      { name: '🎯 Цель недели: вместе поймать рыбу', value: goalLine },
      {
        name: '🐉 Босс',
        value: boss
          ? `${bossDef(boss).emoji} ${bossDef(boss).name} — HP ${formatNumber(boss.hp)}/${formatNumber(boss.max_hp)} (/boss)`
          : 'Сейчас босса нет (/boss — когда появится)',
      },
      { name: '🎉 События', value: o.events.length ? o.events.map(describeServerEvent).join('\n') : 'Сейчас событий нет' },
      {
        name: '🏆 Рекорды видов',
        value: o.records.length
          ? o.records.map((r, n) => `${n + 1}. ${RARITY_INFO[r.rarity].emoji} ${r.emoji} ${r.name} — **${formatWeight(r.weight)}** (${r.username})`).join('\n')
          : 'Рекордов пока нет',
      },
      {
        name: '💎 Самый редкий улов в истории',
        value: o.rarest
          ? `${RARITY_INFO[o.rarest.rarity].emoji} ${o.rarest.emoji} **${o.rarest.name}** (${RARITY_INFO[o.rarest.rarity].name}) — первым поймал(а) ${o.rarest.username}, <t:${Math.floor(o.rarest.caughtAt / 1000)}:D>`
          : 'Пока никто ничего не поймал',
      },
    );
    await i.reply({ embeds: [embed] });
  },
};

export default command;
