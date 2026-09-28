// /blackjack coins <amount> | /blackjack fish — table embed with owner-only buttons, final PNG card.
// Timeout: an in-memory timer (timeoutMs + grace) per active hand auto-stands it via services/blackjack.expireHand and edits
// the message through the last interaction's token (valid 15 min ≫ 60 s). After a restart the timers are gone: the
// scheduler job `blackjack-expire` settles expired hands in the DB, and a later press on the stale message shows the result.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
} from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { FISH_BY_ID } from '../../data/fish.js';
import { handValue, type BjAction, type Card } from '../../game/blackjack.js';
import { renderBlackjackCard } from '../../render/index.js';
import {
  BlackjackError,
  act,
  betLimits,
  expireHand,
  getHand,
  handsLeftToday,
  listStakeableFish,
  setHandMessage,
  startCoins,
  startFish,
  type BjHand,
  type BjOutcome,
} from '../../services/blackjack.js';
import { getOrCreatePlayer } from '../../services/player.js';
import type { Command, ComponentHandler } from '../types.js';
import { COLORS, customId, formatCoins, formatNumber, formatWeight, makeEmbed, plural, relativeTime, replyEphemeral, assertOwner } from '../ui.js';

const PREFIX_ACTION = 'bj';
const PREFIX_FISH = 'bjf';
const HIDDEN = '🂠';
const TIMER_GRACE_MS = 1000;

type Editor = (payload: InteractionEditReplyOptions) => Promise<unknown>;
const timers = new Map<number, NodeJS.Timeout>();

const ACTION_BY_CODE: Record<string, BjAction> = { h: 'hit', s: 'stand', d: 'double' };

function cardsText(cards: Card[], hideHole = false): string {
  return cards.map((c, n) => (hideHole && n === 1 ? HIDDEN : `\`${c.rank}${c.suit}\``)).join(' ');
}

function totalText(cards: Card[]): string {
  const v = handValue(cards);
  return v.soft && v.total < 21 ? `${v.total} (мягкие)` : String(v.total);
}

function stakeLabel(hand: BjHand): string {
  if (hand.stakeType === 'coins') return formatCoins(hand.stakeValue * (hand.state.doubled ? 2 : 1)) + (hand.state.doubled ? ' (удвоено)' : '');
  const n = hand.stakedFish.length;
  return `🐟 ${n} ${plural(n, 'рыба', 'рыбы', 'рыб')} (${formatCoins(hand.stakeValue)})`;
}

function resultText(o: BjOutcome): string {
  const h = o.hand;
  const fish = h.stakeType === 'fish';
  switch (h.state.result) {
    case 'blackjack':
      return `🂡 **Блэкджек!** Выплата ${formatCoins(h.payout)} (+${formatNumber(o.net)})`;
    case 'win':
      return `🏆 **Победа!** Выплата ${formatCoins(h.payout)} (+${formatNumber(o.net)})`;
    case 'push':
      return fish ? '🤝 **Ничья** — рыба вернулась в садок' : `🤝 **Ничья** — ставка ${formatCoins(h.payout)} возвращена`;
    case 'bust':
      return `💥 **Перебор!** ${fish ? 'Рыба ушла дилеру' : `−${formatNumber(-o.net)} 🪙`}`;
    case 'lose':
      return `💀 **Проигрыш.** ${fish ? 'Рыба ушла дилеру' : `−${formatNumber(-o.net)} 🪙`}`;
    default:
      return '';
  }
}

function buttons(hand: BjHand, canDouble: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(PREFIX_ACTION, 'h', hand.id)).setLabel('Взять').setEmoji('🃏').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(customId(PREFIX_ACTION, 's', hand.id)).setLabel('Хватит').setEmoji('✋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId(PREFIX_ACTION, 'd', hand.id))
      .setLabel('Удвоить')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canDouble),
  );
}

/** Message payload for the current state: live table with buttons, or the final PNG card. */
async function tablePayload(o: BjOutcome, username: string): Promise<InteractionEditReplyOptions> {
  const h = o.hand;
  const { player, dealer } = h.state;
  if (!o.finished) {
    const embed = makeEmbed({
      title: `🃏 Блэкджек — ${username}`,
      color: COLORS.water,
      description: [
        `**Дилер:** ${cardsText(dealer, true)}  (${handValue(dealer.slice(0, 1)).total})`,
        `**Ты:** ${cardsText(player)}  (${totalText(player)})`,
        '',
        `Ставка: ${stakeLabel(h)}`,
        `⏱️ Авто-«Хватит» ${relativeTime(h.expiresAt)}`,
      ].join('\n'),
      footer: `Раздач сегодня осталось: ${o.handsLeft}`,
    });
    return { content: '', embeds: [embed], components: [buttons(h, o.canDouble)], files: [] };
  }
  const result = h.state.result!;
  const color = result === 'win' || result === 'blackjack' ? COLORS.success : result === 'push' ? COLORS.warning : COLORS.danger;
  const embed = makeEmbed({
    title: `🃏 Блэкджек — ${username}`,
    color,
    description: [
      `**Дилер:** ${cardsText(dealer)}  (${totalText(dealer)})`,
      `**Ты:** ${cardsText(player)}  (${totalText(player)})`,
      '',
      `Ставка: ${stakeLabel(h)}`,
      resultText(o),
      o.autoStand ? '⏱️ Время вышло — засчитано «Хватит».' : '',
    ]
      .filter(Boolean)
      .join('\n'),
    footer: `Раздач сегодня осталось: ${o.handsLeft}`,
  });
  if (o.notices.length > 0) embed.addFields({ name: 'Уведомления', value: o.notices.map((n) => n.text).join('\n').slice(0, 1024) });
  const files: AttachmentBuilder[] = [];
  try {
    const png = await renderBlackjackCard({
      player: { cards: player, total: handValue(player).total },
      dealer: { cards: dealer, total: handValue(dealer).total },
      result,
      stakeLabel: stakeLabel(h),
      payout: h.payout,
      username,
    });
    files.push(new AttachmentBuilder(png, { name: 'blackjack.png' }));
    embed.setImage('attachment://blackjack.png');
  } catch (err) {
    console.error('[blackjack] render failed:', err);
  }
  return { content: '', embeds: [embed], components: [], files };
}

function clearTimer(handId: number): void {
  const t = timers.get(handId);
  if (t) clearTimeout(t);
  timers.delete(handId);
}

/** (Re)arms the auto-stand timer of an active hand; the editor edits the table message. */
function armTimer(ctx: GameContext, o: BjOutcome, username: string, edit: Editor): void {
  clearTimer(o.hand.id);
  if (o.finished) return;
  const delay = Math.max(0, o.hand.expiresAt - ctx.clock.now()) + TIMER_GRACE_MS;
  const t = setTimeout(() => {
    timers.delete(o.hand.id);
    void (async () => {
      try {
        const res = expireHand(ctx, o.hand.id);
        if (res) await edit(await tablePayload(res, username));
      } catch (err) {
        console.error('[blackjack] auto-stand failed:', err);
      }
    })();
  }, delay);
  t.unref?.();
  timers.set(o.hand.id, t);
}

async function coins(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const amount = i.options.getInteger('amount', true);
  getOrCreatePlayer(ctx, i.user.id, i.user.username);
  let o: BjOutcome;
  try {
    o = startCoins(ctx, i.user.id, amount);
  } catch (err) {
    if (err instanceof BlackjackError) return replyEphemeral(i, err.message);
    throw err;
  }
  await i.deferReply();
  const msg = await i.editReply(await tablePayload(o, i.user.displayName));
  setHandMessage(ctx, o.hand.id, msg.channelId, msg.id);
  armTimer(ctx, o, i.user.displayName, (p) => i.editReply(p));
}

async function fishMenu(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  getOrCreatePlayer(ctx, i.user.id, i.user.username);
  const fish = listStakeableFish(ctx, i.user.id);
  if (fish.length === 0) return replyEphemeral(i, 'В садке нет рыбы для ставки 🎣');
  if (handsLeftToday(ctx, i.user.id) === 0) return replyEphemeral(i, `Лимит на сегодня исчерпан: ${BALANCE.blackjack.handsPerDay} раздач в сутки.`);
  const { min, max } = betLimits(ctx, i.user.id);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(PREFIX_FISH, i.user.id))
    .setPlaceholder('Выбери рыбу для ставки')
    .setMinValues(1)
    .setMaxValues(fish.length)
    .addOptions(
      fish.map((f) => {
        const sp = FISH_BY_ID[f.species_id];
        const label = `${sp?.emoji ?? '🐟'} ${sp?.name ?? f.species_id} · ${formatWeight(f.weight)} · 🪙 ${f.value}`;
        return { label: label.slice(0, 100), value: String(f.id), description: `${'★'.repeat(f.quality)} · #${f.id}`.slice(0, 100) };
      }),
    );
  const embed = makeEmbed({
    title: `🃏 Блэкджек на рыбу — ${i.user.displayName}`,
    color: COLORS.water,
    description: [
      'Выбери одну или несколько рыб из садка. Они оцениваются по цене продажи.',
      `Ставка: от ${formatCoins(min)} до ${formatCoins(max)}. Выигрыш выплачивается монетами, при ничьей рыба вернётся в садок.`,
      'Жемчуг ставить нельзя.',
    ].join('\n'),
  });
  await i.reply({ embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] });
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('Блэкджек с ботом на монеты или рыбу')
    .addSubcommand((s) =>
      s
        .setName('coins')
        .setDescription('Сыграть на монеты')
        .addIntegerOption((o) => o.setName('amount').setDescription('Ставка в монетах').setRequired(true).setMinValue(BALANCE.blackjack.minBet)),
    )
    .addSubcommand((s) => s.setName('fish').setDescription('Сыграть на рыбу из садка')),
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    if (sub === 'coins') return coins(i, ctx);
    if (sub === 'fish') return fishMenu(i, ctx);
    await replyEphemeral(i, 'Неизвестная подкоманда.');
  },
};

export default command;

export const components: ComponentHandler[] = [
  {
    // bjf:<ownerId> — fish selection submitted
    prefix: PREFIX_FISH,
    async handle(i, args, ctx) {
      if (!i.isStringSelectMenu()) return;
      const ownerId = args[0] ?? '';
      if (!(await assertOwner(i, ownerId))) return;
      const ids = i.values.map(Number).filter((n) => Number.isInteger(n));
      let o: BjOutcome;
      try {
        o = startFish(ctx, ownerId, ids);
      } catch (err) {
        if (err instanceof BlackjackError) return replyEphemeral(i, err.message);
        throw err;
      }
      await i.deferUpdate();
      await i.editReply(await tablePayload(o, i.user.displayName));
      setHandMessage(ctx, o.hand.id, i.channelId, i.message.id);
      armTimer(ctx, o, i.user.displayName, (p) => i.editReply(p));
    },
  },
  {
    // bj:<h|s|d>:<handId> — table buttons
    prefix: PREFIX_ACTION,
    async handle(i, args, ctx) {
      if (!i.isButton()) return;
      const action = ACTION_BY_CODE[args[0] ?? ''];
      const handId = Number(args[1]);
      const hand = Number.isInteger(handId) ? getHand(ctx, handId) : undefined;
      if (!action || !hand) return replyEphemeral(i, 'Эта раздача не найдена 🫧');
      if (!(await assertOwner(i, hand.userId))) return;
      await i.deferUpdate();
      let o: BjOutcome;
      try {
        o = act(ctx, hand.userId, handId, action);
      } catch (err) {
        if (!(err instanceof BlackjackError)) throw err;
        const current = getHand(ctx, handId);
        if (current && current.status === 'finished') {
          // settled elsewhere (timer / scheduler after restart): show the final table
          clearTimer(handId);
          const fin: BjOutcome = { hand: current, finished: true, net: current.payout - finishedStake(current), canDouble: false, handsLeft: handsLeftToday(ctx, current.userId), autoStand: false, notices: [] };
          await i.editReply(await tablePayload(fin, i.user.displayName));
        }
        await replyEphemeral(i, err.message);
        return;
      }
      await i.editReply(await tablePayload(o, i.user.displayName));
      armTimer(ctx, o, i.user.displayName, (p) => i.editReply(p));
      if (o.finished) clearTimer(handId);
    },
  },
];

/** Total staked value of a finished hand (for the net shown on a recovered table); a fish push returned the fish. */
function finishedStake(h: BjHand): number {
  if (h.stakeType === 'fish' && h.state.result === 'push') return 0;
  return h.stakeValue * (h.state.doubled ? 2 : 1);
}

