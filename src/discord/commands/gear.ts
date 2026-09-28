// /gear — equipped gear, aggregated stats and owned items.
import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { GEAR_SLOTS } from '../../data/types.js';
import { lineMistakeBonus } from '../../game/gear-stats.js';
import { reelEscapeThreshold } from '../../game/fishing-session.js';
import { ensurePlayerReady, getPlayerState } from '../../services/player-state.js';
import { gearStatsText, listOwnedGear, upgradeInfo } from '../../services/shop.js';
import type { Command } from '../types.js';
import { COLORS, formatCoins, formatDuration, formatEnergy, makeEmbed, rarityEmoji } from '../ui.js';
import { SLOT_NAMES, clip } from './_wp2-ui.js';

const data = new SlashCommandBuilder().setName('gear').setDescription('Твоё снаряжение и характеристики 🎒');

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  ensurePlayerReady(ctx, i.user.id, i.user.username);
  const st = getPlayerState(ctx, i.user.id);
  const s = st.stats;
  const equippedLines = GEAR_SLOTS.map((slot) => {
    const e = st.equipped.find((x) => x.slot === slot);
    if (!e) return `**${SLOT_NAMES[slot]}:** —`;
    const info = upgradeInfo(ctx, i.user.id, slot);
    const up = info?.cost != null ? `следующая заточка: ${formatCoins(info.cost)}` : 'заточка максимальна';
    const def = info?.def;
    return `**${SLOT_NAMES[slot]}:** ${rarityEmoji(e.tier)} ${e.emoji} ${e.name}${e.upgrade > 0 ? ` **+${e.upgrade}**` : ''}\n${def ? gearStatsText(def, e.upgrade) : ''}${def && gearStatsText(def, e.upgrade) ? ' · ' : ''}${up}`;
  });
  const statLines = [
    `Энергия: ${formatEnergy(st.energy)}/${st.maxEnergy} · заброс ${st.castCost} ⚡ · +1 ⚡ за ${formatDuration(st.regenMsPerPoint)}`,
    `Шанс редкой рыбы: +${Math.round(s.rarityBonus * 100)}%`,
    `Окно подсечки: ${((BALANCE.fishing.hookWindowMs + s.biteWindowMs) / 1000).toFixed(2)} с`,
    `Бонус веса: +${Math.round(s.weightBonus * 100)}%`,
    `Время вываживания: ${((BALANCE.fishing.reelRoundTimeMs + s.reelTimeMs) / 1000).toFixed(2)} с · рыба уходит после ${reelEscapeThreshold(lineMistakeBonus(s))} ошибок`,
    `Леска выдерживает: ${Math.round(s.maxWeight * 10) / 10} кг`,
  ];
  const others = listOwnedGear(ctx, i.user.id).filter((g) => !g.equipped);
  const otherText = others.length
    ? clip(others.map((g) => `${rarityEmoji(g.def.tier)} ${g.def.emoji} ${g.def.name}${g.item.upgrade > 0 ? ` +${g.item.upgrade}` : ''}`).join('\n'), 1000)
    : 'Нет — загляни в `/shop` или открой сундук.';
  const embed = makeEmbed({ title: `🎒 Снаряжение — ${i.user.displayName}`, description: equippedLines.join('\n\n'), color: COLORS.primary, footer: '/equip — надеть · /upgrade — заточить' }).addFields(
    { name: '📊 Характеристики', value: statLines.join('\n') },
    { name: '📦 В рюкзаке', value: otherText },
  );
  await i.reply({ embeds: [embed] });
}

const command: Command = { data, execute };
export default command;
