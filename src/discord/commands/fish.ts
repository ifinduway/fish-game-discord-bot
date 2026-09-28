// /fish [location] — cast → «Клюёт!» → hook → (reel for rare+) → result. Owner-only buttons.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  type InteractionEditReplyOptions,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { CONSUMABLE_BY_ID } from '../../data/consumables.js';
import { LOCATION_BY_ID, LOCATIONS } from '../../data/locations.js';
import { RARITY_INFO, rarityAtLeast, type LocationId } from '../../data/types.js';
import { renderCatchCard, type CatchCardData } from '../../render/index.js';
import { announceCatch } from '../../services/announce.js';
import {
  biteDelay,
  cancelSession,
  getSessionById,
  hookTimeout,
  markBiteShown,
  pressHook,
  pressReel,
  scheduleSession,
  startCast,
  startReelRound,
  type CastError,
  type FishingSession,
  type FishingStep,
} from '../../services/fishing.js';
import { DIRECTIONS, DIRECTION_EMOJI, isDirection } from '../../game/fishing-session.js';
import type { Command, ComponentHandler } from '../types.js';
import { COLORS, assertOwner, customId, formatCoins, formatDuration, formatEnergy, formatNumber, formatWeight, makeEmbed, rarityLabel, replyEphemeral, stars } from '../ui.js';
import { addNotices, locationLabel } from './_wp2-ui.js';

const PREFIX = 'fish';

interface SessionUi {
  edit: (p: InteractionEditReplyOptions) => Promise<unknown>;
  username: string;
  avatarUrl?: string;
}

function uiOf(s: FishingSession): SessionUi | undefined {
  return s.ui as SessionUi | undefined;
}

export function castErrorText(e: CastError): string {
  switch (e.code) {
    case 'busy':
      return 'Ты уже рыбачишь — дождись результата текущего заброса 🎣';
    case 'locked':
      return `${e.location.emoji} ${e.location.name} открывается с **${e.location.unlockLevel}** уровня (у тебя ${e.level}).`;
    case 'cage_full':
      return `🧺 Садок полон (${e.count}/${e.capacity}). Продай рыбу через \`/sell\` или расширь садок в \`/shop\`.`;
    case 'no_energy':
      return `Недостаточно энергии: ${formatEnergy(e.energy)} из ${e.cost} нужных. Хватит на заброс через **${formatDuration(e.msUntil)}**.`;
  }
}

const data = new SlashCommandBuilder()
  .setName('fish')
  .setDescription('Забросить удочку 🎣')
  .addStringOption((o) =>
    o
      .setName('location')
      .setDescription('Локация (запоминается)')
      .addChoices(...LOCATIONS.map((l) => ({ name: `${l.emoji} ${l.name} (ур. ${l.unlockLevel}+)`, value: l.id }))),
  );

async function execute(i: Parameters<Command['execute']>[0], ctx: GameContext): Promise<void> {
  const location = i.options.getString('location') as LocationId | null;
  const res = startCast(ctx, i.user.id, { username: i.user.username, location });
  if (!res.ok) return replyEphemeral(i, castErrorText(res.error));
  const s = res.session;
  s.ui = {
    edit: (p) => i.editReply(p),
    username: i.user.displayName,
    avatarUrl: i.user.displayAvatarURL({ extension: 'png', size: 128 }),
  } satisfies SessionUi;

  const lines = [`Локация: ${locationLabel(s.location)}`, `Энергия: ${formatEnergy(res.energy)}/${res.maxEnergy} (−${s.castCost})`];
  if (res.bait) {
    const b = CONSUMABLE_BY_ID[res.bait.itemId];
    lines.push(`Наживка: ${b ? `${b.emoji} ${b.name}` : res.bait.itemId} (осталось ${res.bait.castsLeft})`);
  }
  if (res.biteHour) lines.push('🔥 **Час клёва!** Редкая рыба клюёт вдвое чаще.');
  const embed = addNotices(makeEmbed({ title: '🎣 Заброс…', description: lines.join('\n'), color: COLORS.water, footer: 'Жди поклёвки и жми «Подсечь!»' }), res.notices);
  try {
    await i.reply({ embeds: [embed] });
  } catch (err) {
    cancelSession(ctx, s.id);
    throw err;
  }
  scheduleSession(s.id, biteDelay(ctx), () => void showBite(ctx, s.id));
}

async function showBite(ctx: GameContext, id: string): Promise<void> {
  const s = getSessionById(id);
  const ui = s && uiOf(s);
  if (!s || !ui || s.phase !== 'waiting') return;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(PREFIX, 'hook', id)).setLabel('Подсечь!').setEmoji('🎣').setStyle(ButtonStyle.Success),
  );
  try {
    await ui.edit({
      embeds: [makeEmbed({ title: '❗ Клюёт!', description: `Жми **Подсечь!** — у тебя ${(s.window.baseMs / 1000).toFixed(1)} с.`, color: COLORS.warning })],
      components: [row],
    });
  } catch (err) {
    console.error('[fish] bite edit failed:', err);
    cancelSession(ctx, id);
    return;
  }
  if (!markBiteShown(id, ctx.clock.now())) return;
  scheduleSession(id, s.window.totalMs + 50, () => void onHookTimeout(ctx, id));
}

async function onHookTimeout(ctx: GameContext, id: string): Promise<void> {
  const s = getSessionById(id);
  const ui = s && uiOf(s);
  if (!s || !ui) return;
  const step = hookTimeout(ctx, id, ctx.clock.now());
  await renderStep(ctx, step, ui).catch((err) => console.error('[fish] timeout edit failed:', err));
}

async function onReelTimeout(ctx: GameContext, id: string, round: number): Promise<void> {
  const s = getSessionById(id);
  const ui = s && uiOf(s);
  if (!s || !ui) return;
  const step = pressReel(ctx, id, round, null, ctx.clock.now());
  await renderStep(ctx, step, ui).catch((err) => console.error('[fish] reel timeout edit failed:', err));
}

const ESCAPE_TEXT = {
  late: '💨 Сорвалась… Ты не успел подсечь.',
  reel: '💨 Рыба ушла во время вываживания.',
  line: '🧵 Леска оборвалась — рыба оказалась слишком тяжёлой!',
} as const;

async function renderStep(ctx: GameContext, step: FishingStep, ui: SessionUi, edit: SessionUi['edit'] = ui.edit): Promise<void> {
  switch (step.kind) {
    case 'invalid':
      return;
    case 'reel': {
      const s = step.session;
      const o = s.outcome;
      const hint = o.kind === 'fish' ? rarityLabel(o.species.rarity) : '';
      const round0 = step.round - 1;
      const lines = [
        `Что-то крупное на крючке… (${hint})`,
        step.perfect && step.round === 1 ? '🎯 Идеальная подсечка!' : null,
        step.last ? (step.last === 'hit' ? '✅ Отлично, продолжай!' : '❌ Ошибка! Рыба сопротивляется.') : null,
        '',
        `Раунд **${step.round}/${step.rounds}** — жми ${DIRECTION_EMOJI[step.target]}`,
        `Ошибок: ${step.mistakes} (рыба уйдёт при ${step.escapeAt}) · ⏱ ${(step.roundTimeMs / 1000).toFixed(1)} с`,
      ].filter((l): l is string => l !== null);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        DIRECTIONS.map((d) => new ButtonBuilder().setCustomId(customId(PREFIX, 'reel', s.id, round0, d)).setEmoji(DIRECTION_EMOJI[d]).setStyle(ButtonStyle.Primary)),
      );
      await edit({ embeds: [makeEmbed({ title: '🎣 Вываживание!', description: lines.join('\n'), color: o.kind === 'fish' ? RARITY_INFO[o.species.rarity].color : COLORS.primary })], components: [row] });
      if (startReelRound(s.id, ctx.clock.now())) {
        scheduleSession(s.id, step.roundTimeMs + BALANCE.fishing.latencyGraceMs + 50, () => void onReelTimeout(ctx, s.id, round0));
      }
      return;
    }
    case 'escaped': {
      const embed = makeEmbed({
        title: ESCAPE_TEXT[step.reason],
        description: `Возвращено ${formatEnergy(step.refund)} · сейчас ${formatEnergy(step.energy)}`,
        color: COLORS.danger,
      });
      await edit({ embeds: [addNotices(embed, step.notices)], components: [] });
      return;
    }
    case 'junk': {
      const parts = [step.coins > 0 ? `+${formatCoins(step.coins)}` : null, step.xp > 0 ? `+${step.xp} XP` : null].filter(Boolean).join(' · ');
      const embed = makeEmbed({ title: `${step.item.emoji} ${step.item.name}`, description: `Эх, это мусор.${parts ? ` ${parts}` : ''}`, color: COLORS.neutral });
      await edit({ embeds: [addNotices(embed, step.notices)], components: [] });
      return;
    }
    case 'treasure': {
      const got = step.pearls > 0 ? `🐚 ${step.pearls} жемчуг.` : formatCoins(step.coins);
      const embed = makeEmbed({ title: '💎 Мини-клад!', description: `На крючке оказалась шкатулка: **${got}**`, color: COLORS.success });
      await edit({ embeds: [addNotices(embed, step.notices)], components: [] });
      return;
    }
    case 'caught': {
      const r = step.result;
      const sp = r.species;
      const loc = LOCATION_BY_ID[r.location];
      const flags = [
        r.perfect ? '🎯 Идеальная подсечка' : null,
        r.mistakes > 0 ? `⚠️ Ошибок при вываживании: ${r.mistakes}` : null,
        r.firstOfSpecies ? `🆕 Новый вид в коллекции! +🐚 ${r.pearls}` : null,
        r.record ? '🏆 Рекорд сервера!' : null,
        r.seasonal ? '🍂 Сезонная рыба' : null,
      ].filter(Boolean);
      const embed = makeEmbed({
        title: `${sp.emoji} ${sp.name}`,
        description: `${rarityLabel(sp.rarity)}\n${flags.join('\n')}`,
        color: RARITY_INFO[sp.rarity].color,
        footer: `${loc ? `${loc.emoji} ${loc.name}` : r.location} · в садке #${r.fishId}`,
      }).addFields(
        { name: 'Вес', value: formatWeight(r.weight), inline: true },
        { name: 'Качество', value: stars(r.quality), inline: true },
        { name: 'Цена', value: formatCoins(r.value), inline: true },
        { name: 'Опыт', value: `+${formatNumber(r.xp)} XP`, inline: true },
      );
      addNotices(embed, step.notices);
      const payload: InteractionEditReplyOptions = { embeds: [embed], components: [] };
      let image: Buffer | undefined;
      const card: CatchCardData = {
        avatarUrl: ui.avatarUrl,
        username: ui.username,
        species: { name: sp.name, rarity: sp.rarity, description: sp.description, emoji: sp.emoji },
        weight: r.weight,
        quality: r.quality,
        perfect: r.perfect,
        value: r.value,
        location: loc ? loc.name : r.location,
        firstOfSpecies: r.firstOfSpecies,
        record: r.record,
        seasonal: r.seasonal,
      };
      if (rarityAtLeast(sp.rarity, 'rare')) {
        try {
          image = await renderCatchCard(card);
          payload.files = [new AttachmentBuilder(image, { name: 'catch.png' })];
          embed.setImage('attachment://catch.png');
        } catch (err) {
          console.error('[fish] catch card render failed:', err);
        }
      }
      await edit(payload);
      if (rarityAtLeast(sp.rarity, 'epic')) void announceCatch(ctx, { userId: step.session.userId, card, image });
      return;
    }
  }
}

async function handle(i: MessageComponentInteraction | ModalSubmitInteraction, args: string[], ctx: GameContext): Promise<void> {
  const at = ctx.clock.now();
  if (!i.isButton()) return;
  const [action, id = '', roundStr, dir] = args;
  const s = getSessionById(id);
  if (!s) return replyEphemeral(i, 'Эта рыбалка уже закончилась 🫧');
  if (!(await assertOwner(i, s.userId))) return;
  const ui = uiOf(s);
  let step: FishingStep = { kind: 'invalid' };
  if (action === 'hook') step = pressHook(ctx, id, at);
  else if (action === 'reel' && dir && isDirection(dir)) step = pressReel(ctx, id, Number(roundStr), dir, at);
  await i.deferUpdate().catch(() => undefined);
  if (step.kind === 'invalid' || !ui) return;
  await renderStep(ctx, step, ui, (p) => i.editReply(p));
}

export const components: ComponentHandler[] = [{ prefix: PREFIX, handle }];

const command: Command = { data, execute };
export default command;
