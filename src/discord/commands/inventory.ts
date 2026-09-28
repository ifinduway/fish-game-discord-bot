// /inventory — садок (paginated, 10/page) + consumables + active bait.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type InteractionUpdateOptions,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { GameContext } from '../../core/context.js';
import { CONSUMABLE_BY_ID } from '../../data/consumables.js';
import { countCaughtFish, listCaughtFish, listConsumables } from '../../db/repos/inventory.js';
import { requirePlayer } from '../../db/repos/players.js';
import { getBalance } from '../../db/repos/wallet.js';
import { cageSummary } from '../../services/economy.js';
import { ensurePlayerReady, getPlayerState } from '../../services/player-state.js';
import type { Command, ComponentHandler } from '../types.js';
import { COLORS, assertOwner, customId, formatCoins, formatPearls, makeEmbed } from '../ui.js';
import { fishLine } from './_wp2-ui.js';

const PREFIX = 'inv';
const PAGE_SIZE = 10;

const data = new SlashCommandBuilder().setName('inventory').setDescription('Садок и рюкзак 🧺');

function payload(ctx: GameContext, userId: string, name: string, page: number): Pick<InteractionUpdateOptions, 'embeds' | 'components'> {
  const player = requirePlayer(ctx, userId);
  const summary = cageSummary(ctx, userId);
  const staked = countCaughtFish(ctx, userId, true) - summary.count;
  const pages = Math.max(1, Math.ceil(summary.count / PAGE_SIZE));
  const p = Math.max(0, Math.min(pages - 1, page));
  const fish = listCaughtFish(ctx, userId, { orderBy: 'caught_desc', limit: PAGE_SIZE, offset: p * PAGE_SIZE });
  const bal = getBalance(ctx, userId);
  const cage = fish.length
    ? fish.map((f) => `\`#${f.id}\` ${fishLine(f)}`).join('\n')
    : 'Садок пуст — самое время для `/fish` 🎣';
  const consumables = listConsumables(ctx, userId)
    .map((c) => {
      const d = CONSUMABLE_BY_ID[c.item_id];
      return `${d?.emoji ?? '🎁'} ${d?.name ?? c.item_id} ×${c.qty}`;
    })
    .join('\n');
  const bait = getPlayerState(ctx, userId).bait;
  const baitDef = bait ? CONSUMABLE_BY_ID[bait.itemId] : undefined;
  const embed = makeEmbed({
    title: `🧺 Садок — ${name} (${summary.count}/${player.cage_capacity})`,
    description: cage,
    color: COLORS.water,
    footer: `Страница ${p + 1}/${pages} · общая цена ${summary.value} мон.${staked > 0 ? ` · на кону в блэкджеке: ${staked}` : ''}`,
  }).addFields(
    { name: '💰 Кошелёк', value: `${formatCoins(bal.coins)} · ${formatPearls(bal.pearls)}`, inline: true },
    { name: '🪱 Наживка', value: bait ? `${baitDef?.emoji ?? '🪱'} ${baitDef?.name ?? bait.itemId} (${bait.castsLeft})` : 'нет', inline: true },
    { name: '🎒 Расходники', value: consumables || 'пусто' },
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(PREFIX, userId, p - 1)).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(p <= 0),
    new ButtonBuilder().setCustomId(customId(PREFIX, userId, p + 1)).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(p >= pages - 1),
  );
  return { embeds: [embed], components: pages > 1 ? [row] : [] };
}

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  ensurePlayerReady(ctx, i.user.id, i.user.username);
  await i.reply(payload(ctx, i.user.id, i.user.displayName, 0));
}

async function handle(i: MessageComponentInteraction | ModalSubmitInteraction, args: string[], ctx: GameContext): Promise<void> {
  if (!i.isButton()) return;
  const [owner = '', pageStr = '0'] = args;
  if (!(await assertOwner(i, owner))) return;
  await i.update(payload(ctx, owner, i.user.displayName, Number.parseInt(pageStr, 10) || 0));
}

export const components: ComponentHandler[] = [{ prefix: PREFIX, handle }];
const command: Command = { data, execute };
export default command;
