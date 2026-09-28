// /sell all | rarity <r> | fish <id> — sells unstaked fish from the cage.
import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import type { GameContext } from '../../core/context.js';
import { RARITIES, RARITY_INFO, type Rarity } from '../../data/types.js';
import { listSellable, sellFish, type SellFilter } from '../../services/economy.js';
import type { Command } from '../types.js';
import { COLORS, formatCoins, makeEmbed, plural, rarityLabel, replyEphemeral } from '../ui.js';
import { addNotices, fishChoiceLabel } from './_wp2-ui.js';
import { getBalance } from '../../db/repos/wallet.js';

const data = new SlashCommandBuilder()
  .setName('sell')
  .setDescription('Продать рыбу из садка 💰')
  .addSubcommand((s) => s.setName('all').setDescription('Продать всю рыбу'))
  .addSubcommand((s) =>
    s
      .setName('rarity')
      .setDescription('Продать всю рыбу одной редкости')
      .addStringOption((o) =>
        o
          .setName('rarity')
          .setDescription('Редкость')
          .setRequired(true)
          .addChoices(...RARITIES.map((r) => ({ name: RARITY_INFO[r].name, value: r }))),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('fish')
      .setDescription('Продать конкретную рыбу')
      .addStringOption((o) => o.setName('fish').setDescription('Рыба из садка').setRequired(true).setAutocomplete(true)),
  );

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const sub = i.options.getSubcommand();
  let filter: SellFilter;
  let what: string;
  if (sub === 'rarity') {
    const rarity = i.options.getString('rarity', true) as Rarity;
    filter = { kind: 'rarity', rarity };
    what = `(${rarityLabel(rarity)})`;
  } else if (sub === 'fish') {
    const fishId = Number.parseInt(i.options.getString('fish', true).replace(/^#/, ''), 10);
    if (!Number.isInteger(fishId)) return replyEphemeral(i, 'Выбери рыбу из списка.');
    filter = { kind: 'fish', fishId };
    what = `#${fishId}`;
  } else {
    filter = { kind: 'all' };
    what = '';
  }
  const res = sellFish(ctx, i.user.id, filter);
  if (res.count === 0) {
    return replyEphemeral(i, sub === 'fish' ? 'Такой рыбы нет в садке (или она сейчас на кону в блэкджеке).' : `Нечего продавать ${what}`.trim() + ' 🧺');
  }
  const coins = getBalance(ctx, i.user.id).coins;
  const embed = makeEmbed({
    title: '💰 Улов продан',
    description: `Продано **${res.count}** ${plural(res.count, 'рыба', 'рыбы', 'рыб')} ${what} за **${formatCoins(res.coins)}**.\nБаланс: ${formatCoins(coins)}`,
    color: COLORS.success,
  });
  await i.reply({ embeds: [addNotices(embed, res.notices)] });
}

async function autocomplete(i: AutocompleteInteraction, ctx: GameContext): Promise<void> {
  const q = i.options.getFocused().toString().toLowerCase();
  const rows = listSellable(ctx, i.user.id, 100)
    .map((f) => ({ name: fishChoiceLabel(f), value: String(f.id) }))
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25);
  await i.respond(rows);
}

const command: Command = { data, execute, autocomplete };
export default command;
