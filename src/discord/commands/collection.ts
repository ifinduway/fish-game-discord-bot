// /collection [location] — encyclopedia paginated by location; unknown species shown as ❓.
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
import { LOCATIONS } from '../../data/locations.js';
import type { LocationId } from '../../data/types.js';
import { getPlayer } from '../../db/repos/players.js';
import { collectionProgress, getCollectionPage } from '../../services/collection.js';
import type { Command, ComponentHandler } from '../types.js';
import { assertOwner, customId, formatPercent, formatWeight, makeEmbed, progressBar, rarityColor, rarityEmoji, stars } from '../ui.js';
import { clip } from './_wp2-ui.js';

const PREFIX = 'col';

const data = new SlashCommandBuilder()
  .setName('collection')
  .setDescription('Коллекция пойманных видов 📖')
  .addStringOption((o) =>
    o
      .setName('location')
      .setDescription('Локация')
      .addChoices(...LOCATIONS.map((l) => ({ name: `${l.emoji} ${l.name}`, value: l.id }))),
  );

function payload(ctx: GameContext, userId: string, name: string, index: number): Pick<InteractionUpdateOptions, 'embeds' | 'components'> {
  const n = LOCATIONS.length;
  const idx = ((index % n) + n) % n;
  const page = getCollectionPage(ctx, userId, LOCATIONS[idx]!.id);
  const total = collectionProgress(ctx, userId);
  const lines = page.entries.map((e) => {
    const r = rarityEmoji(e.species.rarity);
    if (!e.caught) return `${r} ❓ ???`;
    const c = e.caught;
    return `${r} ${e.species.emoji} **${e.species.name}** ×${c.count} · рекорд ${formatWeight(c.best_weight)} · ${stars(c.best_quality)}${e.species.seasonTheme ? ' · 🍂' : ''}`;
  });
  const pct = page.total > 0 ? page.caught / page.total : 0;
  const embed = makeEmbed({
    title: `📖 Коллекция — ${page.location.emoji} ${page.location.name}`,
    description: clip(`${progressBar(page.caught, page.total)} ${page.caught}/${page.total} (${formatPercent(pct)})\n\n${lines.join('\n') || 'Видов пока нет.'}`),
    color: page.caught === page.total && page.total > 0 ? rarityColor('legendary') : rarityColor('rare'),
    footer: `${name} · всего ${total.caught}/${total.total} (${formatPercent(total.total ? total.caught / total.total : 0)}) · локация ${idx + 1}/${n}`,
  });
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(PREFIX, userId, idx - 1)).setEmoji('◀️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId(PREFIX, userId, idx + 1)).setEmoji('▶️').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const loc = (i.options.getString('location') ?? getPlayer(ctx, i.user.id)?.location ?? 'pond') as LocationId;
  const idx = Math.max(0, LOCATIONS.findIndex((l) => l.id === loc));
  await i.reply(payload(ctx, i.user.id, i.user.displayName, idx));
}

async function handle(i: MessageComponentInteraction | ModalSubmitInteraction, args: string[], ctx: GameContext): Promise<void> {
  if (!i.isButton()) return;
  const [owner = '', idxStr = '0'] = args;
  if (!(await assertOwner(i, owner))) return;
  await i.update(payload(ctx, owner, i.user.displayName, Number.parseInt(idxStr, 10) || 0));
}

export const components: ComponentHandler[] = [{ prefix: PREFIX, handle }];
const command: Command = { data, execute };
export default command;
