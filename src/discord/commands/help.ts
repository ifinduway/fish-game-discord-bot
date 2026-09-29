// /help — overview embed + select menu with one section per game system. Text pulls numbers from BALANCE
// so it stays accurate if balance changes. Component prefix `help`.
import {
  ActionRowBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';
import { BALANCE } from '../../config/balance.js';
import type { Command, ComponentHandler } from '../types.js';
import { COLORS, assertOwner, customId, makeEmbed } from '../ui.js';

const PREFIX = 'help';

interface Section {
  id: string;
  label: string;
  emoji: string;
  title: string;
  body: () => string;
}

const min = (ms: number): number => Math.round(ms / 60_000);

const SECTIONS: Section[] = [
  {
    id: 'fishing',
    label: 'Рыбалка и энергия',
    emoji: '🎣',
    title: 'Рыбалка и энергия',
    body: () =>
      [
        `\`/fish [location]\` — забросить удочку. Стоимость: **${BALANCE.energy.castCost} ⚡** (снаряжение может снизить, минимум ${BALANCE.energy.minCastCost}).`,
        `Энергия: максимум **${BALANCE.energy.max} ⚡**, восстановление **1 ⚡ / ${min(BALANCE.energy.regenMsPerPoint)} мин** (полный бак за ~4 ч).`,
        `Клюёт через 1.5–5 с — жми «Подсечь!» в первые **${Math.round(BALANCE.fishing.perfectFraction * 100)}%** окна для идеальной подсечки (+★). Опоздал — рыба уходит, энергия возвращается частично.`,
        `Редкая+ рыба запускает вываживание (2–3 раунда); ${BALANCE.fishing.reelMistakesToEscape} ошибки без бонуса лески — рыба уходит.`,
        `\`/locations\` — список локаций и требуемый уровень. \`/collection\` — какие виды уже пойманы.`,
      ].join('\n'),
  },
  {
    id: 'gear',
    label: 'Снаряжение и магазин',
    emoji: '🧰',
    title: 'Снаряжение и магазин',
    body: () =>
      [
        `\`/shop\` — витрина по категориям + предложение дня. \`/buy <товар> [кол-во]\` — купить снаряжение, расходники или расширение садка.`,
        `\`/equip <предмет>\` — надеть снаряжение (слоты: удочка, катушка, леска, костюм). \`/gear\` — твоё снаряжение и характеристики.`,
        `\`/upgrade <слот>\` — заточка надетого снаряжения, до +${BALANCE.upgrade.maxLevel} уровня (+${Math.round(BALANCE.upgrade.statBonusPerLevel * 100)}% к статам за уровень).`,
        `\`/use <предмет>\` — выпить энергетик (+${BALANCE.energy.drinkEnergy} ⚡, до ${BALANCE.energy.drinksPerDay} раз в день) или закинуть наживку.`,
        `\`/inventory\` — садок (пойманная рыба) и рюкзак (расходники). \`/sell\` — продать рыбу из садка за монеты.`,
      ].join('\n'),
  },
  {
    id: 'economy',
    label: 'Валюты и сундуки',
    emoji: '💰',
    title: 'Валюты и сундуки',
    body: () =>
      [
        `🪙 Монеты — от продажи рыбы, тратятся в магазине. 🐚 Жемчуг — за активность (первая поимка вида, испытания, ежедневка, босс), тратится на сундуки.`,
        `\`/daily\` — ежедневная награда жемчугом (растёт со серией дней, максимум ${BALANCE.daily.maxPearls} 🐚). Пропуск дня сбрасывает серию.`,
        `\`/chest open <тип> [кол-во]\` — сундуки: 🪵 Деревянный ${BALANCE.chests.prices.wood} 🐚, 🥈 Серебряный ${BALANCE.chests.prices.silver} 🐚, 🥇 Золотой ${BALANCE.chests.prices.gold} 🐚.`,
        `Гарант: Серебряный — не позже ${BALANCE.chests.pity.silver.opens}-го открытия (мин. редкость ${BALANCE.chests.pity.silver.minRarity}); Золотой — не позже ${BALANCE.chests.pity.gold.opens}-го (мин. редкость ${BALANCE.chests.pity.gold.minRarity}). \`/chest info\` — точные шансы.`,
      ].join('\n'),
  },
  {
    id: 'progression',
    label: 'Испытания, сезон и пасс',
    emoji: '🏆',
    title: 'Испытания, сезон и пасс',
    body: () =>
      [
        `\`/challenges\` — ${BALANCE.challenges.dailyCount} ежедневных и ${BALANCE.challenges.weeklyCount} еженедельных испытания, прогресс отслеживается автоматически. Выполнение всех ежедневных даёт бонус +${BALANCE.challenges.allDailyBonusPearls} 🐚.`,
        `\`/season\` — текущий сезон (длится ${BALANCE.season.durationDays} дн.), твоя статистика и топ-${BALANCE.season.topPlaces} категорий. В конце сезона сбрасываются только сезонный рейтинг и пасс — снаряжение, валюты и коллекция остаются.`,
        `\`/pass\` — сезонный пасс: ${BALANCE.pass.levels} уровней наград, ${BALANCE.pass.xpPerLevel} XP за уровень. XP пасса даёт заброс, поимка, испытания и урон боссу.`,
        `Топ-3 сезонных категорий получают постоянный титул и значок сезона.`,
      ].join('\n'),
  },
  {
    id: 'boss',
    label: 'Босс и события',
    emoji: '🐉',
    title: 'Босс и события',
    body: () =>
      [
        `\`/boss\` — серверный босс: HP-полоса, время до ухода, топ урона. Появляется по расписанию (вт/пт) или по команде админа, живёт ${BALANCE.boss.durationHours} ч.`,
        `Наносишь урон, ловя рыбу в локации босса. Награды по вкладу: топ вкладчики получают больше 🪙/🐚, победитель — титул «Гроза боссов».`,
        `Серверные события (по расписанию или от админа): ⏰ Час клёва — ×${BALANCE.events.biteHourRarityMultiplier} к шансу редкой+ рыбы; 🏆 Турнир — приз за самую тяжёлую рыбу за час.`,
        `\`/server\` — общая статистика сервера, рекорды и цель недели (награда всем активным игрокам при выполнении).`,
      ].join('\n'),
  },
  {
    id: 'stats',
    label: 'Статистика и рейтинги',
    emoji: '📊',
    title: 'Статистика и рейтинги',
    body: () =>
      [
        `\`/profile [user]\` — карточка рыбака: уровень, энергия, снаряжение, валюты, титул.`,
        `\`/stats [user]\` — подробная статистика (уловы, редкости, рекорды и т.д.).`,
        `\`/top <категория>\` — рейтинги (8 категорий, включая Казино). Недельные категории сбрасываются в понедельник с объявлением победителей в канале анонсов.`,
        `\`/collection [location]\` — какие виды пойманы/не пойманы; первая поимка вида даёт жемчуг и сохраняет рекорд веса.`,
      ].join('\n'),
  },
  {
    id: 'blackjack',
    label: 'Блэкджек',
    emoji: '🃏',
    title: 'Блэкджек',
    body: () =>
      [
        `\`/blackjack coins <ставка>\` — игра на монеты, ставка от ${BALANCE.blackjack.minBet} до ${BALANCE.blackjack.maxBetBase} + ${BALANCE.blackjack.maxBetPerLevel}×уровень.`,
        `\`/blackjack fish\` — игра на рыбу из садка (по цене продажи). Жемчуг ставить нельзя.`,
        `Лимит: ${BALANCE.blackjack.handsPerDay} раздач в сутки. Блэкджек платит ×${BALANCE.blackjack.blackjackPayout}, обычная победа ×${BALANCE.blackjack.winPayout}, ничья возвращает ставку (рыба — в садок).`,
        `Не отвечаешь ${BALANCE.blackjack.timeoutMs / 1000} с — автоматическое «Хватит».`,
      ].join('\n'),
  },
  {
    id: 'admin',
    label: 'Админ',
    emoji: '⚙️',
    title: 'Админ',
    body: () =>
      [
        `\`/admin\` доступен только с правом Manage Guild, все ответы видны только тебе, каждое действие пишется в журнал.`,
        `\`/admin config channel|timezone|show\` — канал анонсов и часовой пояс сервера.`,
        `\`/admin boss spawn|end\` — управление боссом. \`/admin event start <bite_hour|tournament> [минуты]\` — серверные события.`,
        `\`/admin season start|end\` — старт/завершение сезона (сброс сезонного рейтинга и пасса + подведение итогов).`,
        `\`/admin give <user> <coins|pearls|item|gear|cosmetic> [id] [qty]\` — выдать награду. \`/admin take <user> <coins|pearls> <qty>\` — списать валюту.`,
        `\`/admin reset-user <user>\` — полный сброс прогресса игрока (с подтверждением, необратимо).`,
      ].join('\n'),
  },
];

const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

function overviewPayload(): Pick<InteractionReplyOptions, 'embeds' | 'components'> {
  const embed = makeEmbed({
    title: '🎣 Рыбалка — справка',
    description: [
      'Лови рыбу, качай снаряжение, участвуй в испытаниях, сезоне и боссах — выбери раздел ниже, чтобы увидеть подробности и команды.',
      '',
      SECTIONS.map((s) => `${s.emoji} **${s.label}**`).join('\n'),
    ].join('\n'),
    color: COLORS.primary,
    footer: 'Выбери раздел в меню ниже',
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(PREFIX, 'overview'))
    .setPlaceholder('Выбери раздел')
    .addOptions(SECTIONS.map((s) => ({ label: s.label, value: s.id, emoji: s.emoji })));
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

function sectionPayload(section: Section): Pick<InteractionReplyOptions, 'embeds' | 'components'> {
  const embed = makeEmbed({
    title: `${section.emoji} ${section.title}`,
    description: section.body(),
    color: COLORS.primary,
    footer: 'Выбери другой раздел в меню ниже',
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId(PREFIX, 'overview'))
    .setPlaceholder('Выбери раздел')
    .addOptions(SECTIONS.map((s) => ({ label: s.label, value: s.id, emoji: s.emoji, default: s.id === section.id })));
  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

async function execute(i: ChatInputCommandInteraction): Promise<void> {
  await i.reply(overviewPayload());
}

const command: Command = {
  data: new SlashCommandBuilder().setName('help').setDescription('Справка по всем командам и механикам'),
  execute,
};
export default command;

export const components: ComponentHandler[] = [
  {
    prefix: PREFIX,
    async handle(i) {
      if (!i.isStringSelectMenu()) return;
      // help select menus are visible only to the invoker (ephemeral reply), so no ownership arg is embedded —
      // but guard anyway in case of future non-ephemeral use.
      if (!(await assertOwner(i, i.user.id))) return;
      const section = SECTION_BY_ID.get(i.values[0] ?? '');
      await i.update(section ? sectionPayload(section) : overviewPayload());
    },
  },
];
