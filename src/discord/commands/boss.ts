// /boss — server boss: HP card, time left, location, top contributors + your damage; next scheduled spawn when none.
import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import { nextBossSlot } from '../../game/boss.js';
import { renderBossCard } from '../../render/index.js';
import { bossDef, buildBossCard, expireDueBosses, getActiveBoss, getUserContribution, locationLabel } from '../../services/boss.js';
import type { Command } from '../types.js';
import { COLORS, formatDuration, formatNumber, makeEmbed, progressBar } from '../ui.js';

const command: Command = {
  data: new SlashCommandBuilder().setName('boss').setDescription('Серверный босс: здоровье, время и топ урона'),
  async execute(i, ctx) {
    await i.deferReply();
    expireDueBosses(ctx);
    const now = ctx.clock.now();
    const boss = getActiveBoss(ctx);

    if (!boss) {
      const next = nextBossSlot(now, ctx.config.timezone);
      const embed = makeEmbed({
        title: '🐉 Босса сейчас нет',
        description: [
          `Следующее появление: <t:${Math.floor(next / 1000)}:F> (<t:${Math.floor(next / 1000)}:R>).`,
          `Босс живёт ${BALANCE.boss.durationHours} ч. Ловите рыбу в его локации, чтобы нанести урон!`,
        ].join('\n'),
        color: COLORS.neutral,
      });
      await i.editReply({ embeds: [embed] });
      return;
    }

    const def = bossDef(boss);
    const card = buildBossCard(ctx, boss);
    const mine = getUserContribution(ctx, boss.id, i.user.id);
    const embed = makeEmbed({
      title: `${def.emoji} ${def.name}`,
      description: [
        def.description,
        '',
        `📍 Локация: **${locationLabel(boss.location)}**`,
        `❤️ HP: ${progressBar(boss.hp, boss.max_hp, 12)} **${formatNumber(boss.hp)}**/${formatNumber(boss.max_hp)}`,
        `⏳ Осталось: **${formatDuration(boss.expires_at - now)}**`,
        mine
          ? `⚔️ Твой урон: **${formatNumber(mine.damage)}** (${mine.hits} попад., место #${mine.place})`
          : '⚔️ Ты ещё не нанёс(ла) урона — поймай рыбу в локации босса!',
      ].join('\n'),
      color: COLORS.danger,
    });
    if (card.top.length) {
      embed.addFields({
        name: `Топ-${card.top.length} урона`,
        value: card.top.map((t, n) => `${n + 1}. ${t.username} — ${formatNumber(t.damage)}`).join('\n'),
      });
    }
    const files: AttachmentBuilder[] = [];
    try {
      files.push(new AttachmentBuilder(await renderBossCard(card), { name: 'boss.png' }));
      embed.setImage('attachment://boss.png');
    } catch (err) {
      console.error('[boss] render failed:', err);
    }
    await i.editReply({ embeds: [embed], files });
  },
};

export default command;
