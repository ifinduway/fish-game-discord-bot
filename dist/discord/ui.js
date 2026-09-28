// Shared discord-layer UI helpers: rarity colors/emojis, ru-RU formatting, progress bars, owner checks, error replies.
import { EmbedBuilder, MessageFlags, } from 'discord.js';
import { BALANCE } from '../config/balance.js';
import { RARITY_INFO } from '../data/types.js';
export const COLORS = {
    primary: 0x3498db,
    success: 0x2ecc71,
    warning: 0xf1c40f,
    danger: 0xe74c3c,
    neutral: 0x95a5a6,
    water: 0x1abc9c,
};
export const ERROR_TEXT = 'Что-то пошло не так 🐟';
export const NOT_OWNER_TEXT = 'Это не твоя удочка 🎣';
export function rarityColor(r) {
    return RARITY_INFO[r].color;
}
export function rarityEmoji(r) {
    return RARITY_INFO[r].emoji;
}
/** "🔵 Редкая" */
export function rarityLabel(r) {
    return `${RARITY_INFO[r].emoji} ${RARITY_INFO[r].name}`;
}
const intFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
/** ru-RU number: "12 345", "1,5" (up to `digits` decimals). */
export function formatNumber(n, digits = 0) {
    if (digits === 0)
        return intFmt.format(Math.round(n));
    if (digits === 2)
        return decFmt.format(n);
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
}
export const formatCoins = (n) => `🪙 ${formatNumber(n)}`;
export const formatPearls = (n) => `🐚 ${formatNumber(n)}`;
export const formatEnergy = (n) => `⚡ ${formatNumber(Math.floor(n))}`;
/** "1,25 кг" */
export const formatWeight = (kg) => `${formatNumber(kg, 2)} кг`;
/** "★★★☆☆" */
export function stars(quality, max = BALANCE.fishing.maxQuality) {
    const q = Math.max(0, Math.min(max, Math.round(quality)));
    return '★'.repeat(q) + '☆'.repeat(max - q);
}
export const formatPercent = (fraction, digits = 0) => `${formatNumber(fraction * 100, digits)}%`;
/** Text progress bar, e.g. "▰▰▰▰▱▱▱▱▱▱". */
export function progressBar(current, max, length = 10, full = '▰', empty = '▱') {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    const filled = Math.round(ratio * length);
    return full.repeat(filled) + empty.repeat(length - filled);
}
/** Russian plural: plural(5, 'рыба', 'рыбы', 'рыб') → 'рыб'. */
export function plural(n, one, few, many) {
    const a = Math.abs(Math.trunc(n)) % 100;
    const b = a % 10;
    if (a > 10 && a < 20)
        return many;
    if (b > 1 && b < 5)
        return few;
    if (b === 1)
        return one;
    return many;
}
/** Russian compact duration: "2 д 3 ч", "1 ч 5 мин", "4 мин 10 с", "45 с". */
export function formatDuration(ms) {
    let s = Math.max(0, Math.ceil(ms / 1000));
    const d = Math.floor(s / 86400);
    s -= d * 86400;
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    const m = Math.floor(s / 60);
    s -= m * 60;
    if (d > 0)
        return h > 0 ? `${d} д ${h} ч` : `${d} д`;
    if (h > 0)
        return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
    if (m > 0)
        return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
    return `${s} с`;
}
/** Discord relative timestamp "<t:…:R>". */
export const relativeTime = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
/** Builds a customId `${prefix}:${args.join(':')}`; throws if longer than 100 chars. */
export function customId(prefix, ...args) {
    const id = [prefix, ...args.map(String)].join(':');
    if (id.length > BALANCE.discord.maxCustomIdLength)
        throw new Error(`customId too long (${id.length}): ${id}`);
    return id;
}
export function makeEmbed(opts = {}) {
    const e = new EmbedBuilder().setColor(opts.color ?? COLORS.primary);
    if (opts.title)
        e.setTitle(opts.title);
    if (opts.description)
        e.setDescription(opts.description);
    if (opts.footer)
        e.setFooter({ text: opts.footer });
    return e;
}
/** Ephemeral reply that works whether or not the interaction was already replied/deferred. Never throws. */
export async function replyEphemeral(i, content) {
    try {
        if (i.replied || i.deferred)
            await i.followUp({ content, flags: MessageFlags.Ephemeral });
        else
            await i.reply({ content, flags: MessageFlags.Ephemeral });
    }
    catch (err) {
        console.error('[ui] ephemeral reply failed:', err);
    }
}
/** Generic error reply ("Что-то пошло не так 🐟"). Never throws. */
export async function errorReply(i, text = ERROR_TEXT) {
    if (!i.isRepliable())
        return;
    await replyEphemeral(i, text);
}
/** Returns true if `i.user` is the owner; otherwise replies ephemeral "Это не твоя удочка 🎣" and returns false. */
export async function assertOwner(i, ownerId) {
    if (i.user.id === ownerId)
        return true;
    await replyEphemeral(i, NOT_OWNER_TEXT);
    return false;
}
//# sourceMappingURL=ui.js.map