// /stats [user] — full personal statistics (spec §11 + blackjack).
import { SlashCommandBuilder } from 'discord.js';
import { RARITY_INFO } from '../../data/types.js';
import { getPlayer } from '../../db/repos/players.js';
import { xpToNext } from '../../game/levels.js';
import { getPlayerState } from '../../services/player-state.js';
import { getOrCreatePlayer } from '../../services/player.js';
import { getPlayerStatsView } from '../../services/server.js';
import type { Command } from '../types.js';
import { COLORS, formatCoins, formatNumber, formatPercent, formatPearls, formatWeight, makeEmbed, replyEphemeral } from '../ui.js';

const RECORDS_SHOWN = 10;

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Подробная статистика рыбака')
    .addUserOption((o) => o.setName('user').setDescription('Чью статистику показать (по умолчанию твою)')),
  async execute(i, ctx) {
    const target = i.options.getUser('user') ?? i.user;
    if (target.bot) {
      await replyEphemeral(i, 'У ботов нет удочек 🤖');
      return;
    }
    const self = target.id === i.user.id;
    const player = self ? getOrCreatePlayer(ctx, target.id, target.username) : getPlayer(ctx, target.id);
    if (!player) {
      await replyEphemeral(i, `${target.username} ещё ни разу не рыбачил(а) 🎣`);
      return;
    }
    const view = getPlayerStatsView(ctx, target.id)!;
    const state = getPlayerState(ctx, target.id);
    const s = (k: string): number => view.stats[k] ?? 0;
    const n = (k: string): string => formatNumber(s(k));
    const next = xpToNext(player.level);

    const embed = makeEmbed({
      title: `📊 Статистика — ${player.username || target.username}`,
      description: view.activeTitle ? `🏷️ ${view.activeTitle}` : undefined,
      color: COLORS.primary,
    });
    embed.setThumbnail(target.displayAvatarURL({ extension: 'png', size: 128 }));
    embed.addFields(
      {
        name: '⭐ Уровень',
        value: [
          `Уровень **${player.level}** · ${Number.isFinite(next) ? `${formatNumber(player.xp)}/${formatNumber(next)} XP` : 'MAX'}`,
          `⚡ Энергия: **${Math.floor(state.energy)}**/${state.maxEnergy}`,
          `🔥 Серия входов: **${player.daily_streak}** дн.`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '💰 Валюты',
        value: [
          `${formatCoins(player.coins)} · ${formatPearls(player.pearls)}`,
          `Заработано: ${formatCoins(s('coins_earned'))}`,
          `Потрачено: ${formatCoins(s('coins_spent'))}`,
          `Жемчуга получено: ${formatPearls(s('pearls_earned'))}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🎣 Рыбалка',
        value: [
          `Забросов: **${n('casts')}** · поймано: **${n('catches')}** · сорвалось: **${n('escapes')}**`,
          `Идеальных подсечек: **${n('perfects')}** (${formatPercent(view.perfectRate, 1)})`,
          `Общий вес: **${formatWeight(s('total_weight'))}** · самая тяжёлая: **${formatWeight(s('heaviest_weight'))}**`,
          `Мусор: ${n('junk')} · новых видов: ${n('new_species')}`,
        ].join('\n'),
      },
      {
        name: '🌈 По редкостям',
        value: view.byRarity.map((r) => `${RARITY_INFO[r.rarity].emoji} ${RARITY_INFO[r.rarity].name}: **${formatNumber(r.count)}**`).join('\n'),
        inline: true,
      },
      {
        name: '📖 Коллекция',
        value: [
          `**${view.collection.caught}**/${view.collection.total} видов (${formatPercent(view.collection.total ? view.collection.caught / view.collection.total : 0)})`,
          `🎁 Сундуков открыто: **${n('chests_opened')}**`,
          `⚔️ Урон по боссам: **${n('boss_damage')}** · боссов: **${n('bosses_joined')}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: '🃏 Блэкджек',
        value: [
          `Раздач: **${n('bj_hands')}** · побед: **${n('bj_wins')}** · поражений: **${n('bj_losses')}** · ничьих: **${n('bj_pushes')}**`,
          `Блэкджеков: **${n('bj_blackjacks')}** · чистый результат: **${s('bj_net') > 0 ? '+' : ''}${formatNumber(s('bj_net'))}** 🪙`,
          `Крупнейший выигрыш: ${formatCoins(s('bj_biggest_win'))}`,
        ].join('\n'),
      },
      {
        name: `🏆 Личные рекорды (${Math.min(RECORDS_SHOWN, view.personalRecords.length)}/${view.personalRecords.length})`,
        value: view.personalRecords.length
          ? view.personalRecords
              .slice(0, RECORDS_SHOWN)
              .map((r) => `${RARITY_INFO[r.rarity].emoji} ${r.emoji} ${r.name} — **${formatWeight(r.weight)}** (×${r.count})`)
              .join('\n')
          : 'Пока ничего не поймано',
      },
      { name: '🏷️ Титулы', value: view.titles.length ? view.titles.join(', ').slice(0, 1024) : 'Нет титулов' },
    );
    await i.reply({ embeds: [embed] });
  },
};

export default command;
