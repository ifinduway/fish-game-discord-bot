import { RARITY_INFO } from '../data/types.js';
import { renderCatchCard } from '../render/index.js';
async function send(ctx, payload) {
    if (!ctx.announce)
        return;
    try {
        await ctx.announce(payload);
    }
    catch (err) {
        console.error('[announce] failed:', err);
    }
}
export async function announceCatch(ctx, data) {
    if (!ctx.announce)
        return;
    const { card } = data;
    const info = RARITY_INFO[card.species.rarity];
    let image = data.image;
    if (!image) {
        try {
            image = await renderCatchCard(card);
        }
        catch (err) {
            console.error('[announce] catch card render failed:', err);
        }
    }
    const extras = [card.perfect ? '🎯 идеальная подсечка' : null, card.firstOfSpecies ? '🆕 первый улов вида' : null, card.record ? '🏆 рекорд сервера' : null]
        .filter(Boolean)
        .join(' · ');
    await send(ctx, {
        title: `${info.emoji} ${info.name} рыба поймана!`,
        description: `<@${data.userId}> поймал(а) **${card.species.emoji ?? '🐟'} ${card.species.name}** — ${card.weight} кг, ${'★'.repeat(card.quality)} (${card.location})${extras ? `\n${extras}` : ''}`,
        color: info.color,
        file: image ? { name: 'catch.png', data: image } : undefined,
    });
}
export async function announceText(ctx, title, text, color, file) {
    await send(ctx, { title, description: text, color, file });
}
//# sourceMappingURL=announce.js.map