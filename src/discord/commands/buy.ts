// /buy <item> [qty] — buys a shop listing (gear, consumables, cage expansion).
import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { buy, shopEntries } from '../../services/shop.js';
import type { Command } from '../types.js';
import { COLORS, formatCoins, makeEmbed, replyEphemeral } from '../ui.js';
import { addNotices } from './_wp2-ui.js';

const data = new SlashCommandBuilder()
  .setName('buy')
  .setDescription('Купить товар из магазина 🛒')
  .addStringOption((o) => o.setName('item').setDescription('Товар').setRequired(true).setAutocomplete(true))
  .addIntegerOption((o) => o.setName('qty').setDescription('Количество (для расходников)').setMinValue(1).setMaxValue(BALANCE.shop.maxBuyQty));

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const id = i.options.getString('item', true);
  const qty = i.options.getInteger('qty') ?? 1;
  const res = buy(ctx, i.user.id, id, qty);
  if (!res.ok) {
    const name = res.entry ? `${res.entry.emoji} ${res.entry.name}` : id;
    const text: Record<typeof res.reason, string> = {
      unknown: 'Такого товара нет. Загляни в `/shop`.',
      level: `${name} доступен с ${res.entry?.listing.unlockLevel ?? '?'} уровня.`,
      owned: `У тебя уже есть ${name}. Надень его через \`/equip\`.`,
      maxed: 'Садок уже максимального размера 🧺',
      unavailable: `${name} сейчас не продаётся.`,
      qty: `Количество: от 1 до ${BALANCE.shop.maxBuyQty} (снаряжение и садок — по одному).`,
      funds: res.reason === 'funds' ? `Не хватает монет: нужно ${formatCoins(res.required)}, у тебя ${formatCoins(res.available)}.` : '',
    };
    return replyEphemeral(i, text[res.reason]);
  }
  const e = res.entry;
  const embed = makeEmbed({
    title: '🛍️ Покупка',
    description: `${e.emoji} **${e.name}**${res.qty > 1 ? ` ×${res.qty}` : ''} — ${formatCoins(res.spent)}${e.isOffer ? ' (скидка дня 🔥)' : ''}\nБаланс: ${formatCoins(res.coins)}`,
    color: COLORS.success,
    footer: e.listing.kind === 'gear' ? 'Надень через /equip' : e.listing.kind === 'consumable' ? 'Используй через /use' : undefined,
  });
  await i.reply({ embeds: [addNotices(embed, res.notices)] });
}

async function autocomplete(i: AutocompleteInteraction, ctx: GameContext): Promise<void> {
  const q = i.options.getFocused().toString().toLowerCase();
  const choices = shopEntries(ctx, i.user.id)
    .filter((e) => e.price !== null)
    .map((e) => ({
      name: `${e.name} — ${e.price} мон.${e.isOffer ? ' (скидка)' : ''}${e.levelOk ? '' : ` (ур. ${e.listing.unlockLevel})`}`.slice(0, 100),
      value: e.listing.id,
    }))
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q))
    .slice(0, 25);
  await i.respond(choices);
}

const command: Command = { data, execute, autocomplete };
export default command;
