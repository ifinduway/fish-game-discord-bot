// /profile [user] — PNG profile card: avatar, level/XP, energy, gear, currencies, title/frame/background, key stats, collection, pass.
import { AttachmentBuilder, SlashCommandBuilder } from 'discord.js';
import { COSMETIC_BY_ID } from '../../data/cosmetics.js';
import { getPlayer } from '../../db/repos/players.js';
import { xpToNext } from '../../game/levels.js';
import { renderProfileCard, type ProfileCardData } from '../../render/index.js';
import { getPlayerState } from '../../services/player-state.js';
import { getOrCreatePlayer } from '../../services/player.js';
import { getPassProgress } from '../../services/season.js';
import { cosmeticName, getPlayerStatsView } from '../../services/server.js';
import type { Command } from '../types.js';
import { COLORS, formatNumber, formatPercent, formatWeight, makeEmbed, replyEphemeral } from '../ui.js';

function cosmeticView(id: string | null): ProfileCardData['frame'] {
  if (!id) return undefined;
  const def = COSMETIC_BY_ID[id];
  return def ? { name: def.name, color: def.color, gradient: def.gradient } : { name: id };
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Профиль рыбака')
    .addUserOption((o) => o.setName('user').setDescription('Чей профиль показать (по умолчанию твой)')),
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
    await i.deferReply();
    const state = getPlayerState(ctx, target.id);
    const view = getPlayerStatsView(ctx, target.id)!;
    const pass = getPassProgress(ctx, target.id);
    const s = view.stats;
    const data: ProfileCardData = {
      avatarUrl: target.displayAvatarURL({ extension: 'png', size: 256 }),
      username: player.username || target.username,
      level: player.level,
      xp: player.xp,
      xpNext: Number.isFinite(xpToNext(player.level)) ? xpToNext(player.level) : player.xp,
      energy: Math.floor(state.energy),
      maxEnergy: state.maxEnergy,
      coins: player.coins,
      pearls: player.pearls,
      title: player.active_title ? cosmeticName(player.active_title) : undefined,
      frame: cosmeticView(player.active_frame),
      background: cosmeticView(player.active_background),
      gear: state.equipped.map((g) => ({ slot: g.slot, name: g.name, tier: g.tier, upgrade: g.upgrade })),
      stats: [
        { label: 'Поймано рыб', value: formatNumber(s.catches ?? 0) },
        { label: 'Забросов', value: formatNumber(s.casts ?? 0) },
        { label: 'Идеальные подсечки', value: formatPercent(view.perfectRate) },
        { label: 'Общий вес', value: formatWeight(s.total_weight ?? 0) },
        { label: 'Самая тяжёлая', value: formatWeight(s.heaviest_weight ?? 0) },
        { label: 'Редкие+', value: formatNumber(s.rare_plus ?? 0) },
      ],
      collection: view.collection,
      seasonPass: pass ? { level: pass.level, max: pass.maxLevel } : undefined,
    };
    try {
      const png = await renderProfileCard(data);
      await i.editReply({ files: [new AttachmentBuilder(png, { name: 'profile.png' })] });
    } catch (err) {
      console.error('[profile] render failed:', err);
      const embed = makeEmbed({
        title: `🎣 ${data.username} — ур. ${data.level}`,
        description: [
          data.title ? `🏷️ ${data.title}` : null,
          `⚡ ${data.energy}/${data.maxEnergy} · 🪙 ${formatNumber(data.coins)} · 🐚 ${formatNumber(data.pearls)}`,
          ...data.stats.map((x) => `${x.label}: **${x.value}**`),
        ]
          .filter(Boolean)
          .join('\n'),
        color: COLORS.primary,
      });
      await i.editReply({ embeds: [embed] });
    }
  },
};

export default command;
