// Discord implementation of ctx.announce: sends an embed (+ optional PNG) to the configured announce channel.
import { AttachmentBuilder, type Client } from 'discord.js';
import type { AnnouncePayload, GameContext } from '../core/context.js';
import { COLORS, makeEmbed } from './ui.js';

export function createAnnouncer(client: Client, ctx: GameContext): (payload: AnnouncePayload) => Promise<void> {
  return async (payload) => {
    const channelId = ctx.config.announceChannelId;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isSendable()) {
      console.warn(`[announce] channel ${channelId} is not available`);
      return;
    }
    const embed = makeEmbed({ title: payload.title, description: payload.description, color: payload.color ?? COLORS.primary, footer: payload.footer });
    if (payload.fields?.length) embed.addFields(payload.fields.map((f) => ({ name: f.name, value: f.value, inline: f.inline ?? false })));
    const files: AttachmentBuilder[] = [];
    if (payload.file) {
      files.push(new AttachmentBuilder(payload.file.data, { name: payload.file.name }));
      embed.setImage(`attachment://${payload.file.name}`);
    }
    await channel.send({ content: payload.content, embeds: [embed], files, allowedMentions: { parse: [] } });
  };
}
