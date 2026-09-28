# 🎣 Discord-бот «Рыбалка»

Игра-рыбалка для одного Discord-сервера: забросы с мини-игрой «Подсечь!», снаряжение, сундуки, испытания, сезоны с пассом, серверный босс, рейтинги и блэкджек.

## Требования

- Node.js 20+ (проверено на 22)
- Yarn 1.x
- Windows / Linux / macOS (нативные модули `better-sqlite3` и `@napi-rs/canvas` ставятся из готовых сборок)

## Установка

```bash
yarn install
cp .env.example .env   # затем заполните значения
```

Переменные `.env`:

| Переменная | Описание |
|---|---|
| `DISCORD_TOKEN` | токен бота (Developer Portal → Bot → Reset Token) |
| `CLIENT_ID` | Application ID (Developer Portal → General Information) |
| `GUILD_ID` | ID вашего сервера (ПКМ по серверу → «Копировать ID», нужен режим разработчика) |
| `DB_PATH` | путь к файлу SQLite, по умолчанию `data/fishing.db` |
| `TZ_DEFAULT` | часовой пояс сбросов, по умолчанию `Europe/Moscow` |

## Приглашение бота на сервер

В Developer Portal → OAuth2 → URL Generator выберите:

- **Scopes:** `bot`, `applications.commands`
- **Bot Permissions:** `View Channels`, `Send Messages`, `Embed Links`, `Attach Files`, `Read Message History`, `Use External Emojis`

Привилегированные интенты не нужны (используется только `Guilds`).

## Запуск

```bash
yarn dev        # разработка (tsx watch)
yarn build      # компиляция в dist/
yarn start      # запуск собранной версии
yarn deploy     # вручную зарегистрировать slash-команды на GUILD_ID (бот делает это и сам при старте)
yarn test       # тесты (vitest)
yarn typecheck  # проверка типов
```

После первого запуска администратор задаёт канал анонсов и часовой пояс командой `/admin config`.

## Команды

Полный список появится по мере реализации (см. `/help` в игре):

`/fish`, `/profile`, `/stats`, `/inventory`, `/sell`, `/shop`, `/buy`, `/equip`, `/gear`, `/upgrade`, `/use`, `/chest open`, `/chest info`, `/daily`, `/challenges`, `/season`, `/pass`, `/boss`, `/top`, `/server`, `/collection`, `/locations`, `/blackjack`, `/help`, `/admin …`

## Для разработчиков

- Архитектура и контракты модулей: `docs/CONTRACTS.md`
- Все числа баланса: `src/config/balance.ts`
- Каталоги (рыбы, снаряжение, сундуки, испытания…): `src/data/*.ts`
- Новая команда = новый файл в `src/discord/commands/` (подхватывается автоматически)
