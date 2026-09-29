// /admin — Manage Guild only (default member permission + runtime check). All replies ephemeral.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { GameContext } from '../../core/context.js';
import { BOSSES } from '../../data/bosses.js';
import { COSMETICS } from '../../data/cosmetics.js';
import { CONSUMABLES } from '../../data/consumables.js';
import { GEAR } from '../../data/gear.js';
import { InsufficientFundsError } from '../../db/repos/wallet.js';
import { SERVER_EVENT_INFO, SERVER_EVENT_TYPES, type ServerEventType } from '../../game/server-events.js';
import {
  AdminError,
  adminEndBoss,
  adminEndSeason,
  adminSpawnBoss,
  adminStartEvent,
  adminStartSeason,
  getConfigSummary,
  giveReward,
  resetUser,
  setAnnounceChannel,
  setTimezone,
  takeCurrency,
  type GiveKind,
} from '../../services/admin.js';
import { bossDef, BossError, locationLabel } from '../../services/boss.js';
import { ServerEventError } from '../../services/server-events.js';
import type { Command, ComponentHandler } from '../types.js';
import { assertOwner, customId, formatCoins, formatPearls, replyEphemeral } from '../ui.js';

const PREFIX = 'adm';
const RESET_CONFIRM_MS = 30_000;
/** targetId:actorId -> expires-at (ms, ctx.clock time) */
const resetConfirmations = new Map<string, number>();

const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Администрирование бота (нужно право Manage Guild)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommandGroup((g) =>
    g
      .setName('config')
      .setDescription('Настройки сервера')
      .addSubcommand((s) =>
        s
          .setName('channel')
          .setDescription('Канал анонсов')
          .addChannelOption((o) =>
            o
              .setName('channel')
              .setDescription('Канал для анонсов')
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      )
      .addSubcommand((s) =>
        s
          .setName('timezone')
          .setDescription('Часовой пояс сервера')
          .addStringOption((o) => o.setName('tz').setDescription('IANA часовой пояс, например Europe/Moscow').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('show').setDescription('Показать текущие настройки')),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('boss')
      .setDescription('Управление боссом')
      .addSubcommand((s) =>
        s
          .setName('spawn')
          .setDescription('Заспавнить босса')
          .addStringOption((o) => o.setName('boss').setDescription('Конкретный босс (иначе случайный)').addChoices(...BOSSES.map((b) => ({ name: b.name, value: b.id })))),
      )
      .addSubcommand((s) => s.setName('end').setDescription('Завершить текущего босса')),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('event')
      .setDescription('Серверные события')
      .addSubcommand((s) =>
        s
          .setName('start')
          .setDescription('Запустить событие')
          .addStringOption((o) =>
            o
              .setName('type')
              .setDescription('Тип события')
              .setRequired(true)
              .addChoices(...SERVER_EVENT_TYPES.map((t) => ({ name: SERVER_EVENT_INFO[t].name, value: t }))),
          )
          .addIntegerOption((o) => o.setName('minutes').setDescription('Длительность в минутах (по умолчанию из баланса)').setMinValue(1)),
      ),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('season')
      .setDescription('Управление сезоном')
      .addSubcommand((s) => s.setName('start').setDescription('Начать новый сезон (только если ни один не активен)'))
      .addSubcommand((s) => s.setName('end').setDescription('Завершить текущий сезон и начать следующий')),
  )
  .addSubcommand((s) =>
    s
      .setName('give')
      .setDescription('Выдать награду игроку')
      .addUserOption((o) => o.setName('user').setDescription('Игрок').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('kind')
          .setDescription('Тип награды')
          .setRequired(true)
          .addChoices(
            { name: 'Монеты', value: 'coins' },
            { name: 'Жемчуг', value: 'pearls' },
            { name: 'Предмет', value: 'item' },
            { name: 'Снаряжение', value: 'gear' },
            { name: 'Косметика', value: 'cosmetic' },
          ),
      )
      .addStringOption((o) => o.setName('id').setDescription('ID предмета/снаряжения/косметики (для kind ≠ монеты/жемчуг)').setAutocomplete(true))
      .addIntegerOption((o) => o.setName('qty').setDescription('Количество (по умолчанию 1)').setMinValue(1).setMaxValue(1_000_000)),
  )
  .addSubcommand((s) =>
    s
      .setName('take')
      .setDescription('Списать валюту у игрока (для отладки)')
      .addUserOption((o) => o.setName('user').setDescription('Игрок').setRequired(true))
      .addStringOption((o) =>
        o
          .setName('currency')
          .setDescription('Валюта')
          .setRequired(true)
          .addChoices({ name: 'Монеты', value: 'coins' }, { name: 'Жемчуг', value: 'pearls' }),
      )
      .addIntegerOption((o) => o.setName('qty').setDescription('Количество').setRequired(true).setMinValue(1)),
  )
  .addSubcommand((s) =>
    s
      .setName('reset-user')
      .setDescription('Полностью сбросить прогресс игрока (необратимо, с подтверждением)')
      .addUserOption((o) => o.setName('user').setDescription('Игрок').setRequired(true)),
  );

async function handleConfig(i: ChatInputCommandInteraction, ctx: GameContext, sub: string): Promise<void> {
  if (sub === 'channel') {
    const channel = i.options.getChannel('channel', true);
    setAnnounceChannel(ctx, i.user.id, channel.id);
    return replyEphemeral(i, `✅ Канал анонсов: <#${channel.id}>`);
  }
  if (sub === 'timezone') {
    const tz = i.options.getString('tz', true);
    setTimezone(ctx, i.user.id, tz);
    return replyEphemeral(i, `✅ Часовой пояс сервера: **${tz}**`);
  }
  // show
  const cfg = getConfigSummary(ctx);
  return replyEphemeral(
    i,
    [`📢 Канал анонсов: ${cfg.announceChannelId ? `<#${cfg.announceChannelId}>` : 'не задан'}`, `🕒 Часовой пояс: **${cfg.timezone}**`].join('\n'),
  );
}

async function handleBoss(i: ChatInputCommandInteraction, ctx: GameContext, sub: string): Promise<void> {
  if (sub === 'spawn') {
    const bossId = i.options.getString('boss') ?? undefined;
    const row = adminSpawnBoss(ctx, i.user.id, bossId);
    const def = bossDef(row);
    return replyEphemeral(i, `✅ Заспавнен босс: ${def.emoji} ${def.name} (${locationLabel(row.location)})`);
  }
  adminEndBoss(ctx, i.user.id);
  return replyEphemeral(i, '✅ Текущий босс завершён.');
}

async function handleEvent(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const type = i.options.getString('type', true) as ServerEventType;
  const minutes = i.options.getInteger('minutes') ?? undefined;
  const row = adminStartEvent(ctx, i.user.id, type, minutes);
  return replyEphemeral(i, `✅ Событие запущено: ${SERVER_EVENT_INFO[type].name} — закончится <t:${Math.floor(row.ends_at / 1000)}:R>.`);
}

async function handleSeason(i: ChatInputCommandInteraction, ctx: GameContext, sub: string): Promise<void> {
  if (sub === 'start') {
    const season = adminStartSeason(ctx, i.user.id);
    return replyEphemeral(i, `✅ Начат сезон: **${season.name}**`);
  }
  const summary = adminEndSeason(ctx, i.user.id);
  return replyEphemeral(i, `✅ Сезон **${summary.season.name}** завершён. Начался **${summary.next.name}**.`);
}

async function handleGive(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const user = i.options.getUser('user', true);
  const kind = i.options.getString('kind', true) as GiveKind;
  const id = i.options.getString('id') ?? undefined;
  const qty = i.options.getInteger('qty') ?? 1;
  const res = giveReward(ctx, i.user.id, user.id, kind, id, qty);
  return replyEphemeral(i, `✅ Выдано <@${user.id}>: ${res.summary}`);
}

async function handleTake(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const user = i.options.getUser('user', true);
  const currency = i.options.getString('currency', true) as 'coins' | 'pearls';
  const qty = i.options.getInteger('qty', true);
  const res = takeCurrency(ctx, i.user.id, user.id, currency, qty);
  const label = currency === 'coins' ? formatCoins(res.balance) : formatPearls(res.balance);
  return replyEphemeral(i, `✅ Списано ${res.taken} у <@${user.id}>. Новый баланс: ${label}`);
}

async function handleResetUser(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  const user = i.options.getUser('user', true);
  const key = `${user.id}:${i.user.id}`;
  resetConfirmations.set(key, ctx.clock.now() + RESET_CONFIRM_MS);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId(PREFIX, 'reset', user.id, i.user.id))
      .setLabel('Подтвердить сброс')
      .setEmoji('⚠️')
      .setStyle(ButtonStyle.Danger),
  );
  await i.reply({
    content: `⚠️ Точно полностью сбросить прогресс <@${user.id}>? Это необратимо. Подтверждение действует 30 секунд.`,
    components: [row],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

async function execute(i: ChatInputCommandInteraction, ctx: GameContext): Promise<void> {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return replyEphemeral(i, 'Нужно право Manage Guild.');
  }
  try {
    const group = i.options.getSubcommandGroup(false);
    const sub = i.options.getSubcommand();
    if (group === 'config') return await handleConfig(i, ctx, sub);
    if (group === 'boss') return await handleBoss(i, ctx, sub);
    if (group === 'event') return await handleEvent(i, ctx);
    if (group === 'season') return await handleSeason(i, ctx, sub);
    if (sub === 'give') return await handleGive(i, ctx);
    if (sub === 'take') return await handleTake(i, ctx);
    if (sub === 'reset-user') return await handleResetUser(i, ctx);
    await replyEphemeral(i, 'Неизвестная подкоманда.');
  } catch (err) {
    if (err instanceof AdminError || err instanceof BossError || err instanceof ServerEventError || err instanceof InsufficientFundsError) {
      return replyEphemeral(i, err.message);
    }
    throw err;
  }
}

async function autocomplete(i: AutocompleteInteraction, ctx: GameContext): Promise<void> {
  void ctx;
  const kind = i.options.getString('kind') as GiveKind | null;
  const q = i.options.getFocused().toString().toLowerCase();
  let choices: { name: string; value: string }[] = [];
  if (kind === 'item') choices = CONSUMABLES.map((c) => ({ name: `${c.emoji} ${c.name}`, value: c.id }));
  else if (kind === 'gear') choices = GEAR.map((g) => ({ name: `${g.emoji} ${g.name} (${g.slot})`, value: g.id }));
  else if (kind === 'cosmetic') choices = COSMETICS.map((c) => ({ name: `${c.name} (${c.type})`, value: c.id }));
  const filtered = choices.filter((c) => !q || c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q)).slice(0, 25);
  await i.respond(filtered.map((c) => ({ name: c.name.slice(0, 100), value: c.value })));
}

const command: Command = { data, execute, autocomplete };
export default command;

export const components: ComponentHandler[] = [
  {
    prefix: PREFIX,
    async handle(i, args, ctx) {
      if (!i.isButton()) return;
      const [action, targetId, actorId] = args;
      if (action !== 'reset' || !targetId || !actorId) return;
      if (!(await assertOwner(i, actorId))) return;
      const key = `${targetId}:${actorId}`;
      const expiresAt = resetConfirmations.get(key);
      resetConfirmations.delete(key);
      const now = ctx.clock.now();
      for (const [k, exp] of resetConfirmations) if (now > exp) resetConfirmations.delete(k);
      if (!expiresAt || ctx.clock.now() > expiresAt) {
        await i.update({ content: '⌛ Время подтверждения истекло. Повтори `/admin reset-user`.', components: [] });
        return;
      }
      resetUser(ctx, actorId, targetId);
      await i.update({ content: `✅ Прогресс <@${targetId}> полностью сброшен.`, components: [], allowedMentions: { parse: [] } });
    },
  },
];
