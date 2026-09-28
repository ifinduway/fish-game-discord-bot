// /use <item> — energy drink or bait.
import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { CONSUMABLE_BY_ID } from '../../data/consumables.js';
import { listConsumables } from '../../db/repos/inventory.js';
import { useItem } from '../../services/economy.js';
import type { Command } from '../types.js';
import { COLORS, formatEnergy, makeEmbed, replyEphemeral } from '../ui.js';

const data = new SlashCommandBuilder()
  .setName('use')
  .setDescription('Использовать энергетик или наживку 🧃')
  .addStringOption((o) => o.setName('item').setDescription('Предмет').setRequired(true).setAutocomplete(true));

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const id = i.options.getString('item', true);
  const res = useItem(ctx, i.user.id, id);
  if (!res.ok) {
    const text = {
      unknown: 'Такого предмета нет.',
      not_owned: 'У тебя нет этого предмета. Купи в `/shop`.',
      drink_limit: `Больше ${BALANCE.energy.drinksPerDay} энергетиков в сутки нельзя — сердце не железное 🫀`,
      energy_full: `Энергия и так на максимуме (до ${Math.round(BALANCE.energy.overflowCapFactor * 100)}%).`,
      not_usable: 'Этот предмет нельзя использовать.',
    }[res.reason];
    return replyEphemeral(i, text);
  }
  if (res.kind === 'energy') {
    const embed = makeEmbed({
      title: `${res.item.emoji} ${res.item.name}`,
      description: `+${Math.round(res.gained)} ⚡ → ${formatEnergy(res.energy)}/${res.maxEnergy}\nЭнергетиков на сегодня осталось: ${res.drinksLeft}`,
      color: COLORS.warning,
    });
    return void (await i.reply({ embeds: [embed] }));
  }
  const replaced = res.replaced ? CONSUMABLE_BY_ID[res.replaced] : undefined;
  const embed = makeEmbed({
    title: `${res.item.emoji} Наживка: ${res.item.name}`,
    description: `${res.item.description}\nДействует ещё **${res.castsLeft}** забросов.${replaced ? `\nПрежняя наживка (${replaced.name}) снята.` : ''}`,
    color: COLORS.success,
  });
  await i.reply({ embeds: [embed] });
}

async function autocomplete(i: AutocompleteInteraction, ctx: GameContext): Promise<void> {
  const q = i.options.getFocused().toString().toLowerCase();
  const choices = listConsumables(ctx, i.user.id)
    .map((c) => {
      const def = CONSUMABLE_BY_ID[c.item_id];
      return { name: `${def?.name ?? c.item_id} ×${c.qty}`.slice(0, 100), value: c.item_id };
    })
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25);
  await i.respond(choices);
}

const command: Command = { data, execute, autocomplete };
export default command;
