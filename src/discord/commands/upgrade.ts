// /upgrade <slot> — sharpens the equipped item (+1…+5) for coins.
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { GEAR_SLOTS, RARITY_INFO, type GearSlot } from '../../data/types.js';
import { gearStatsText, upgradeGear } from '../../services/shop.js';
import type { Command } from '../types.js';
import { formatCoins, makeEmbed, replyEphemeral } from '../ui.js';
import { SLOT_NAMES, addNotices } from './_wp2-ui.js';

const data = new SlashCommandBuilder()
  .setName('upgrade')
  .setDescription('Заточить надетое снаряжение 🔧')
  .addStringOption((o) =>
    o
      .setName('slot')
      .setDescription('Слот')
      .setRequired(true)
      .addChoices(...GEAR_SLOTS.map((s) => ({ name: SLOT_NAMES[s], value: s }))),
  );

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const slot = i.options.getString('slot', true) as GearSlot;
  const res = upgradeGear(ctx, i.user.id, slot);
  if (!res.ok) {
    if (res.reason !== 'funds') {
      if (res.reason === 'no_gear') return replyEphemeral(i, `В слоте «${SLOT_NAMES[slot]}» ничего не надето.`);
      return replyEphemeral(i, `${res.def?.name ?? 'Предмет'} уже заточен до +${BALANCE.upgrade.maxLevel} ✨`);
    }
    return replyEphemeral(i, `Не хватает монет: заточка до +${res.level + 1} стоит ${formatCoins(res.cost)}, у тебя ${formatCoins(res.available)}.`);
  }
  const embed = makeEmbed({
    title: '🔧 Заточка успешна!',
    description: `${res.def.emoji} **${res.def.name} +${res.level}** — ${formatCoins(res.cost)}\n${gearStatsText(res.def, res.level)}\nБаланс: ${formatCoins(res.coins)}`,
    color: RARITY_INFO[res.def.tier].color,
  });
  await i.reply({ embeds: [addNotices(embed, res.notices)] });
}

const command: Command = { data, execute };
export default command;
