// /equip <item> — equips an owned gear item into its slot.
import { SlashCommandBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import type { GameContext } from '../../core/context.js';
import { RARITY_INFO } from '../../data/types.js';
import { ensurePlayerReady } from '../../services/player-state.js';
import { equipGear, gearStatsText, listOwnedGear } from '../../services/shop.js';
import type { Command } from '../types.js';
import { COLORS, makeEmbed, rarityLabel, replyEphemeral } from '../ui.js';

const data = new SlashCommandBuilder()
  .setName('equip')
  .setDescription('Надеть снаряжение 🎣')
  .addStringOption((o) => o.setName('item').setDescription('Предмет из твоего снаряжения').setRequired(true).setAutocomplete(true));

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const id = Number.parseInt(i.options.getString('item', true), 10);
  if (!Number.isInteger(id)) return replyEphemeral(i, 'Выбери предмет из списка.');
  const res = equipGear(ctx, i.user.id, id);
  if (!res.ok) {
    const text = { not_owned: 'Этого предмета у тебя нет.', unknown: 'Неизвестный предмет.', already: 'Этот предмет уже надет ✅' }[res.reason];
    return replyEphemeral(i, text);
  }
  const embed = makeEmbed({
    title: '✅ Снаряжение надето',
    description: `${res.def.emoji} **${res.def.name}** (${rarityLabel(res.def.tier)})\n${gearStatsText(res.def, 0)}${res.previous ? `\nСнято: ${res.previous.emoji} ${res.previous.name}` : ''}`,
    color: RARITY_INFO[res.def.tier].color ?? COLORS.success,
    footer: 'Характеристики — /gear',
  });
  await i.reply({ embeds: [embed] });
}

async function autocomplete(i: AutocompleteInteraction, ctx: GameContext): Promise<void> {
  ensurePlayerReady(ctx, i.user.id, i.user.username);
  const q = i.options.getFocused().toString().toLowerCase();
  const choices = listOwnedGear(ctx, i.user.id)
    .map((g) => ({
      name: `${g.def.name}${g.item.upgrade > 0 ? ` +${g.item.upgrade}` : ''} (${RARITY_INFO[g.def.tier].name})${g.equipped ? ' — надето' : ''}`.slice(0, 100),
      value: String(g.item.id),
    }))
    .filter((c) => !q || c.name.toLowerCase().includes(q))
    .slice(0, 25);
  await i.respond(choices);
}

const command: Command = { data, execute, autocomplete };
export default command;
