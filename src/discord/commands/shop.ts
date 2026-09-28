// /shop — listings by category (select menu) + «Предложение дня».
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type InteractionUpdateOptions,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { GameContext } from '../../core/context.js';
import { nextDayReset } from '../../core/time.js';
import { getBalance } from '../../db/repos/wallet.js';
import { ensurePlayerReady } from '../../services/player-state.js';
import { SHOP_CATEGORY_NAMES, shopEntries, type ShopCategory, type ShopEntry } from '../../services/shop.js';
import type { Command, ComponentHandler } from '../types.js';
import { COLORS, assertOwner, customId, formatCoins, makeEmbed, relativeTime } from '../ui.js';
import { clip } from './_wp2-ui.js';

const PREFIX = 'shop';
const CATEGORIES = Object.keys(SHOP_CATEGORY_NAMES) as ShopCategory[];

const data = new SlashCommandBuilder().setName('shop').setDescription('Магазин снаряжения и расходников 🛒');

function entryLine(e: ShopEntry): string {
  const price =
    e.price === null ? '—' : e.isOffer && e.basePrice !== null ? `~~${e.basePrice}~~ ${formatCoins(e.price)} 🔥` : formatCoins(e.price);
  const status = [!e.levelOk ? `🔒 ур. ${e.listing.unlockLevel}` : null, e.owned ? '✅ есть' : null, e.price === null && e.listing.kind === 'cage' ? 'максимум' : null]
    .filter(Boolean)
    .join(' · ');
  return `${e.emoji} **${e.name}** — ${price}${status ? ` · ${status}` : ''}\n${e.description ? `${e.description} · ` : ''}\`/buy ${e.listing.id}\``;
}

export function shopPayload(ctx: GameContext, userId: string, category: ShopCategory): Pick<InteractionUpdateOptions, 'embeds' | 'components'> {
  const entries = shopEntries(ctx, userId);
  const offer = entries.find((e) => e.isOffer);
  const list = entries.filter((e) => e.category === category);
  const coins = getBalance(ctx, userId).coins;
  const embed = makeEmbed({
    title: `🛒 Магазин — ${SHOP_CATEGORY_NAMES[category]}`,
    description: clip(list.length > 0 ? list.map(entryLine).join('\n\n') : 'Здесь пока пусто.', 3800),
    color: COLORS.primary,
    footer: `Баланс: 🪙 ${coins}`,
  });
  if (offer) {
    embed.addFields({
      name: '🔥 Предложение дня',
      value: `${offer.emoji} **${offer.name}** — ~~${offer.basePrice}~~ ${formatCoins(offer.price ?? 0)} (\`/buy ${offer.listing.id}\`)\nОбновится ${relativeTime(nextDayReset(ctx.clock.now(), ctx.config.timezone))}`,
    });
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(PREFIX, userId))
    .setPlaceholder('Категория')
    .addOptions(CATEGORIES.map((c) => ({ label: SHOP_CATEGORY_NAMES[c], value: c, default: c === category })));
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  ensurePlayerReady(ctx, i.user.id, i.user.username);
  await i.reply(shopPayload(ctx, i.user.id, 'gear'));
}

async function handle(i: MessageComponentInteraction | ModalSubmitInteraction, args: string[], ctx: GameContext): Promise<void> {
  if (!i.isStringSelectMenu()) return;
  const owner = args[0] ?? '';
  if (!(await assertOwner(i, owner))) return;
  const cat = (CATEGORIES as string[]).includes(i.values[0] ?? '') ? (i.values[0] as ShopCategory) : 'gear';
  await i.update(shopPayload(ctx, owner, cat));
}

export const components: ComponentHandler[] = [{ prefix: PREFIX, handle }];
const command: Command = { data, execute };
export default command;
