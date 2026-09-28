// /chest open <type> [count] — spin animation (≤ BALANCE.chests.spinEdits edits, ≥ spinIntervalMs apart) + summary PNG.
// /chest info [type] — odds from config, price, pity rule, player's pity counter and pearls.
import { AttachmentBuilder, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { GameContext } from '../../core/context.js';
import { CHESTS } from '../../data/chests.js';
import { RARITIES, RARITY_INFO, rarityIndex, type ChestDef, type ChestId, type Rarity } from '../../data/types.js';
import { renderChestCard } from '../../render/index.js';
import { ChestError, chestOdds, chestStatus, openChests, type ChestOpenResult } from '../../services/chest.js';
import { getOrCreatePlayer } from '../../services/player.js';
import type { Command } from '../types.js';
import { formatNumber, formatPearls, makeEmbed, plural, rarityColor, rarityLabel, replyEphemeral } from '../ui.js';

const CHEST_CHOICES = CHESTS.map((c) => ({ name: `${c.emoji} ${c.name} — 🐚 ${c.price}`, value: c.id }));

/** Reel tile per rarity. */
const TILE: Record<Rarity, string> = { common: '⬜', uncommon: '🟩', rare: '🟦', epic: '🟪', legendary: '🟧', mythic: '🟥' };
const WINDOW = 7;
const HALF = Math.floor(WINDOW / 2);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function pointerRow(arrow: string): string {
  return '⬛'.repeat(HALF) + arrow + '⬛'.repeat(HALF);
}

/** Random reel strip whose tile at `target` is the best rarity dropped; tiles weighted by the chest's loot. */
function buildStrip(ctx: GameContext, def: ChestDef, best: Rarity, target: number): Rarity[] {
  const weights = def.loot.map((e) => ({ item: e.rarity, weight: e.weight }));
  const strip: Rarity[] = [];
  for (let n = 0; n <= target + HALF; n++) strip.push(ctx.rng.weighted(weights));
  strip[target] = best;
  return strip;
}

function frame(title: string, strip: Rarity[], center: number, footer: string): string {
  const row = strip.slice(center - HALF, center + HALF + 1).map((r) => TILE[r]).join('');
  return `${title}\n${pointerRow('🔽')}\n${row}\n${pointerRow('🔼')}\n${footer}`;
}

function pityText(res: ChestOpenResult): string {
  if (!res.pity) return '';
  const rar = RARITY_INFO[res.pity.minRarity].name;
  return `🛡️ Гарант (${rar}+): ещё ${res.pity.left} ${plural(res.pity.left, 'открытие', 'открытия', 'открытий')} (счётчик ${res.pity.counter}/${res.pity.opens})`;
}

async function open(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const chestId = i.options.getString('type', true) as ChestId;
  const count = i.options.getInteger('count') ?? 1;
  getOrCreatePlayer(ctx, i.user.id, i.user.username);

  let res: ChestOpenResult;
  try {
    res = openChests(ctx, i.user.id, chestId, count);
  } catch (err) {
    if (err instanceof ChestError) return replyEphemeral(i, err.message);
    throw err;
  }

  const def = res.chest;
  const best = res.rewards.reduce<Rarity>((b, r) => (rarityIndex(r.rarity) > rarityIndex(b) ? r.rarity : b), 'common');
  // PNG renders while the reel spins
  const cardPromise = renderChestCard({
    chest: { name: def.name, emoji: def.emoji },
    rewards: res.rewards.map((r) => ({ label: r.label, rarity: r.rarity, kind: r.kind, cosmeticType: r.cosmeticType, duplicate: r.duplicate })),
    pityLeft: res.pity?.left,
  });

  const title = `${def.emoji} **${def.name}**${res.count > 1 ? ` ×${res.count}` : ''} — ${i.user.displayName}`;
  const target = 24;
  const strip = buildStrip(ctx, def, best, target);
  const spins = Math.max(1, BALANCE.chests.spinEdits);
  const interval = Math.max(BALANCE.chests.spinIntervalMs, BALANCE.discord.minAnimationIntervalMs);
  // centers approach the target: e.g. 3 edits → target-14, target-6, target
  const centers = Array.from({ length: spins }, (_, k) => target - Math.round(((spins - 1 - k) / Math.max(1, spins - 1)) ** 1.5 * 14));

  await i.reply({ content: frame(title, strip, Math.max(HALF, centers[0]! - 6), '🎰 Крутим…') });
  for (let k = 0; k < spins; k++) {
    await sleep(interval);
    const last = k === spins - 1;
    await i.editReply({ content: frame(title, strip, centers[k]!, last ? `✨ ${rarityLabel(best)}!` : '🎰 Крутим…') });
  }

  let png: Buffer | null = null;
  try {
    png = await cardPromise;
  } catch (err) {
    console.error('[chest] render failed:', err);
  }
  await sleep(interval);

  const lines = res.rewards.map((r, n) => `${res.count > 1 ? `**${n + 1}.** ` : ''}${RARITY_INFO[r.rarity].emoji} ${r.label}${r.forcedByPity ? ' 🛡️' : ''}`);
  const footerParts = [pityText(res), `Осталось: ${formatPearls(res.pearlsLeft)}`].filter(Boolean);
  const embed = makeEmbed({
    title: `${def.emoji} ${def.name}${res.count > 1 ? ` ×${res.count}` : ''}: награды`,
    description: [...lines, '', ...footerParts].join('\n'),
    color: rarityColor(best),
  });
  if (res.notices.length > 0) embed.addFields({ name: 'Уведомления', value: res.notices.map((n) => n.text).join('\n').slice(0, 1024) });
  const files = png ? [new AttachmentBuilder(png, { name: 'chest.png' })] : [];
  if (png) embed.setImage('attachment://chest.png');
  await i.editReply({ content: '', embeds: [embed], files });
}

async function info(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const only = i.options.getString('type') as ChestId | null;
  const status = chestStatus(ctx, i.user.id);
  const chests = status.chests.filter((c) => !only || c.chest.id === only);
  const embed = makeEmbed({
    title: '🎁 Сундуки: шансы выпадения',
    description: `Твой жемчуг: ${formatPearls(status.pearls)}\nШансы взяты напрямую из конфигурации игры.`,
  });
  for (const { chest, pity } of chests) {
    const odds = chestOdds(chest)
      .slice()
      .sort((a, b) => rarityIndex(a.entry.rarity) - rarityIndex(b.entry.rarity) || b.percent - a.percent)
      .map((o) => `${RARITY_INFO[o.entry.rarity].emoji} ${o.label} — **${formatNumber(o.percent, 2)}%**`);
    const byRarity = RARITIES.map((r) => {
      const p = chestOdds(chest).filter((o) => o.entry.rarity === r).reduce((s, o) => s + o.percent, 0);
      return p > 0 ? `${RARITY_INFO[r].emoji} ${formatNumber(p, 2)}%` : null;
    }).filter(Boolean);
    const pityLine = pity
      ? `🛡️ Гарант: ${RARITY_INFO[pity.minRarity].name}+ не позже чем через ${pity.opens} открытий. Твой счётчик: ${pity.counter}/${pity.opens} (осталось ≤ ${pity.left})`
      : '🛡️ Гаранта нет';
    const value = [`Цена: ${formatPearls(chest.price)}`, pityLine, `По редкости: ${byRarity.join(' · ')}`, ...odds].join('\n');
    embed.addFields({ name: `${chest.emoji} ${chest.name}`, value: value.slice(0, 1024) });
  }
  await i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('chest')
    .setDescription('Сундуки за жемчуг')
    .addSubcommand((s) =>
      s
        .setName('open')
        .setDescription('Открыть сундук')
        .addStringOption((o) => o.setName('type').setDescription('Тип сундука').setRequired(true).addChoices(...CHEST_CHOICES))
        .addIntegerOption((o) =>
          o.setName('count').setDescription('Сколько открыть').setMinValue(1).setMaxValue(BALANCE.chests.maxOpenCount),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Шансы выпадения и гарант')
        .addStringOption((o) => o.setName('type').setDescription('Тип сундука').addChoices(...CHEST_CHOICES)),
    ),
  async execute(i, ctx) {
    const sub = i.options.getSubcommand();
    if (sub === 'open') return open(i, ctx);
    if (sub === 'info') return info(i, ctx);
    await replyEphemeral(i, 'Неизвестная подкоманда.');
  },
};

export default command;
