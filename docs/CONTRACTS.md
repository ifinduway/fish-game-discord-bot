# WP0 contracts (stable API for WP1–WP7)

Plan: `.omc/plans/autopilot-impl.md` (§4, §5, §8 are binding). This file lists what WP0 actually exports and every
choice the plan left open. Imports use `.js` extensions (ESM NodeNext). Repos take `ctx: DbCtx` (`{ db }`) — a full
`GameContext` always satisfies it; functions needing time/tz take `ScopeCtx` (`{ db, clock, config }`).

## Conventions / decisions
- `players.xp` = progress **inside** the current level (resets on level-up). `game/levels.ts`: `xpToNext(level)` (= round(50·level^1.3), Infinity at cap 100), `totalXp(level, xp)`, `applyXp(level, xp, gained) → {level, xp, levelsGained[]}`.
- `Reward` type lives in `src/data/types.ts` (re-exported by `services/rewards.ts`). `ShopListing`, `JunkItem` also there, plus runtime `RARITIES`, `RARITY_INFO`, `rarityIndex(r)`, `rarityAtLeast(r, min)`, `LOCATION_IDS`, `GEAR_SLOTS`.
- `JUNK_ITEMS` is exported from `src/data/fish.ts`. Gear id convention `<slot>_<tier>`. No starter gear is granted on player creation (WP2 decides).
- Money/inventory: every repo function is a single statement → safe inside the caller's `ctx.db.transaction(...)`. Nested `db.transaction` = savepoint.
- Foreign keys are ON: create the player (e.g. `getOrCreatePlayer`) before inserting caught_fish/gear_items; `deleteGearItem` unequips first.
- `grantReward` does NOT touch stats counters; it throws on unknown item/gear/cosmetic ids (whole grant rolls back).
- `announceCatch` renders the catch card itself if no `image` is passed (only render call outside `discord/`).
- Loader ignores `*.d.ts`, `*.map`, `*.test.*`, `*.spec.*`, names starting with `_` or `.`, non-code files, subdirs → put helpers for commands in `_name.ts`.
- Scheduler: tick every 60 s; the first tick (startup) runs every job; jobs must be idempotent (`repos/periodic.markRun`).
- `ChestCardData.rewards` is an **array** (amendment §8.6 multi-open) instead of the single `reward` in §4.6.
- `BALANCE` (src/config/balance.ts): energy, fishing (hook/perfect/reel/junk/treasure/rarityWeights/quality/xpByRarity), levels, locationUnlockLevels, upgrade, gearDuplicateCoins, cage, firstCatchPearls, daily, shop, chests (prices/pity/spin), challenges, season, pass, passXp, boss, serverGoal, weekly, events, blackjack, discord.

## Signatures
```ts
// core
createContext({ db, rng?, clock?, bus?, defaultTimezone?, announce? }): GameContext   // config.timezone / announceChannelId are live getters on guild_config
seededRng(seed): Rng; createRng(source?): Rng; defaultRng; mulberry32(seed)
systemClock; new FakeClock(ms?).set(ms)/.advance(ms)
dayKey(ms,tz) 'YYYY-MM-DD'; prevDayKey; weekKey(ms,tz) 'YYYY-Www'; prevWeekKey; timeOfDay(ms,tz); TIME_OF_DAY_NAMES
startOfDay; startOfWeek; nextDayReset; nextWeekReset; localParts(ms,tz) {year,month,day,weekday(1=Mon),hour,minute}; isValidTimezone
EventBus.on(type, (e, ctx) => Notice[]|void); .emit(e, ctx): Notice[]; .emitAll(events, ctx); .listenerCount; .clear
loadModules<T>(dir): Promise<{file, module}[]>; loadSubscribers(bus, dir?): Promise<string[]>
// db
openDatabase(path, {migrate?=true}): DB; prepare(db, sql) (cached); inTransaction(db, fn); migrate(db); MIGRATIONS
players: getPlayer, requirePlayer, createPlayer(ctx,id,name,energy,now,cage?), updatePlayer(ctx,id,Partial<PlayerUpdatable>), setEnergy(ctx,id,energy,at), listPlayerIds, countPlayers, topByLevel(ctx,limit)
wallet: getBalance, addCoins/spendCoins/addPearls/spendPearls(ctx,id,amount) → new balance; InsufficientFundsError{currency,required,available}; setBalance
inventory: listConsumables, getConsumableQty, addConsumable, removeConsumable (InsufficientItemsError); getActiveBait/setActiveBait/clearActiveBait;
  addGearItem(ctx,id,gearId,at,upgrade?) → id, listGearItems, getGearItem, hasGear, setGearUpgrade, deleteGearItem;
  getEquipped → slot→itemId, getEquippedItems → slot→row, setEquipped, unequip; addCosmetic(ctx,id,cid,at,source?) → isNew, listCosmetics, hasCosmetic;
  addCaughtFish(ctx,{userId,speciesId,weight,quality,value,location,caughtAt}) → id, listCaughtFish(ctx,id,{includeStaked,orderBy,limit,offset}),
  getCaughtFish, countCaughtFish(ctx,id,includeStaked=false), deleteCaughtFish(ctx,userId,ids) → n, setFishStaked(ctx,userId,ids,bool) → n
stats: defaultScopes(ctx), activeSeasonId(ctx), inc/max(ctx,user,metric,v,scopes?), set(ctx,user,metric,v,scopes=['all']), get(ctx,user,metric,scope='all'), getAll, top(ctx,metric,scope,limit) → {userId,value}[], rank; SCOPE_ALL, scopeDay/scopeWeek/scopeSeason
server-stats: serverDefaultScopes, incServerStat(ctx,metric,delta,scopes?), getServerStat, getAllServerStats
config: getConfig/setConfig/deleteConfig/getAllConfig, CONFIG_KEYS {announceChannelId:'announce_channel_id', timezone:'timezone'}
audit: addAudit(ctx,actorId,action,details?) ; listAudit      periodic: markRun(ctx,job,periodKey) → firstTime, hasRun
// services
getOrCreatePlayer(ctx,userId,username?): PlayerRow; addXp(ctx,userId,amount): {level,xp,levelsGained,notices}
grantReward(ctx,userId,reward,source): {notices, summary}; registerPassXpHandler(fn|null); formatReward(reward); mergeRewards(...r)
announceCatch(ctx,{userId, card: CatchCardData, image?}); announceText(ctx,title,text,color?,file?)
// discord
registry: loadRegistry(dir?), registerModule, commandsJson, registerGuildCommands(token,clientId,guildId,reg); router: createInteractionHandler, parseCustomId
ui: COLORS, rarityColor/Emoji/Label, formatNumber/Coins/Pearls/Energy/Weight/Percent, stars, progressBar, plural, formatDuration, relativeTime, customId, makeEmbed, replyEphemeral, errorReply, assertOwner
// scheduler: Job{name,everyMinutes,run}; loadJobs(dir?); runDueJobs(ctx,jobs,lastRun,now?); startScheduler(ctx,jobs,{tickMs?})
// render: render{Profile,Catch,Chest,Leaderboard,Boss,Blackjack,SeasonSummary}Card(data): Promise<Buffer> (stubs) + all types from render/types.ts
```
Tests: `tests/helpers.ts` → `createTestContext({seed?, now?, timezone?})` (in-memory DB, FakeClock at Mon 2026-01-05 12:00 MSK), `seedPlayer(ctx, id, {coins?, pearls?})`.
