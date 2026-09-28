// Shop & gear service (spec §4–§5, amendment §8.5): listings, daily offer, /buy, /equip, /upgrade.
import { BALANCE } from '../config/balance.js';
import type { GameContext } from '../core/context.js';
import type { Notice } from '../core/events.js';
import { dayKey } from '../core/time.js';
import { CONSUMABLE_BY_ID } from '../data/consumables.js';
import { GEAR_BY_ID } from '../data/gear.js';
import { SHOP_LISTINGS } from '../data/shop.js';
import type { GearDef, GearSlot, ShopListing } from '../data/types.js';
import { addConsumable, addGearItem, getEquippedItems, getGearItem, hasGear, listGearItems, setEquipped, setGearUpgrade, type GearItemRow } from '../db/repos/inventory.js';
import { getPlayer, requirePlayer, updatePlayer } from '../db/repos/players.js';
import { InsufficientFundsError, getBalance, spendCoins } from '../db/repos/wallet.js';
import { cageUpgradeCost, discounted, hashIndex } from '../game/economy.js';
import { upgradeCost } from '../game/gear-stats.js';
import { ensurePlayerReady } from './player-state.js';

export type ShopCategory = 'gear' | 'consumable' | 'upgrade';

export const SHOP_CATEGORY_NAMES: Record<ShopCategory, string> = {
  gear: '🎣 Снаряжение',
  consumable: '🧃 Расходники',
  upgrade: '🧺 Улучшения',
};

export function listingCategory(l: ShopListing): ShopCategory {
  return l.kind === 'gear' ? 'gear' : l.kind === 'consumable' ? 'consumable' : 'upgrade';
}

export function findListing(id: string): ShopListing | undefined {
  return SHOP_LISTINGS.find((l) => l.id === id);
}

/** Catalog price of a gear/consumable listing (undefined → not purchasable). Cage price depends on capacity. */
export function basePrice(l: ShopListing, cageCapacity: number = BALANCE.cage.baseCapacity): number | null {
  if (l.kind === 'cage') return cageUpgradeCost(cageCapacity);
  if (l.price !== undefined) return l.price;
  const ref = l.refId ?? l.id;
  const p = l.kind === 'gear' ? GEAR_BY_ID[ref]?.shopPrice : CONSUMABLE_BY_ID[ref]?.shopPrice;
  return p ?? null;
}

/** «Предложение дня»: one gear/consumable listing chosen deterministically by the server-tz day key. */
export function dailyOffer(ctx: GameContext): ShopListing | null {
  const candidates = SHOP_LISTINGS.filter((l) => l.kind !== 'cage' && basePrice(l) !== null);
  if (candidates.length === 0) return null;
  return candidates[hashIndex(`offer:${dayKey(ctx.clock.now(), ctx.config.timezone)}`, candidates.length)]!;
}

export interface ShopEntry {
  listing: ShopListing;
  category: ShopCategory;
  name: string;
  emoji: string;
  description: string;
  /** null → not purchasable (e.g. cage at max) */
  price: number | null;
  basePrice: number | null;
  isOffer: boolean;
  levelOk: boolean;
  /** gear already owned */
  owned: boolean;
}

function describe(l: ShopListing): { name: string; emoji: string; description: string } {
  if (l.kind === 'cage') return { name: 'Расширение садка', emoji: '🧺', description: `+${BALANCE.cage.upgradeStep} мест (макс. ${BALANCE.cage.maxCapacity})` };
  const ref = l.refId ?? l.id;
  if (l.kind === 'gear') {
    const g = GEAR_BY_ID[ref];
    return g ? { name: g.name, emoji: g.emoji, description: gearStatsText(g, 0) } : { name: ref, emoji: '🎣', description: '' };
  }
  const c = CONSUMABLE_BY_ID[ref];
  return c ? { name: c.name, emoji: c.emoji, description: c.description } : { name: ref, emoji: '🎁', description: '' };
}

export function shopEntries(ctx: GameContext, userId: string): ShopEntry[] {
  const p = getPlayer(ctx, userId);
  const level = p?.level ?? 1;
  const capacity = p?.cage_capacity ?? BALANCE.cage.baseCapacity;
  const offer = dailyOffer(ctx);
  return SHOP_LISTINGS.map((l) => {
    const bp = basePrice(l, capacity);
    const isOffer = offer?.id === l.id;
    return {
      listing: l,
      category: listingCategory(l),
      ...describe(l),
      basePrice: bp,
      price: bp === null ? null : isOffer ? discounted(bp) : bp,
      isOffer,
      levelOk: level >= l.unlockLevel,
      owned: l.kind === 'gear' && p ? hasGear(ctx, userId, l.refId ?? l.id) : false,
    };
  });
}

export type BuyResult =
  | { ok: true; entry: ShopEntry; qty: number; spent: number; coins: number; notices: Notice[] }
  | { ok: false; reason: 'unknown' | 'level' | 'owned' | 'maxed' | 'unavailable' | 'qty'; entry?: ShopEntry }
  | { ok: false; reason: 'funds'; entry: ShopEntry; required: number; available: number };

/** /buy: gear (qty 1, not already owned), consumables (qty 1..maxBuyQty), cage expansion (qty 1). */
export function buy(ctx: GameContext, userId: string, listingId: string, qty = 1): BuyResult {
  ensurePlayerReady(ctx, userId);
  const entry = shopEntries(ctx, userId).find((e) => e.listing.id === listingId);
  if (!entry) return { ok: false, reason: 'unknown' };
  if (!entry.levelOk) return { ok: false, reason: 'level', entry };
  const l = entry.listing;
  if (l.kind !== 'consumable') qty = 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > BALANCE.shop.maxBuyQty) return { ok: false, reason: 'qty', entry };
  if (entry.price === null) return { ok: false, reason: l.kind === 'cage' ? 'maxed' : 'unavailable', entry };
  if (entry.owned) return { ok: false, reason: 'owned', entry };
  const total = entry.price * qty;
  try {
    const coins = ctx.db.transaction(() => {
      const left = spendCoins(ctx, userId, total);
      const ref = l.refId ?? l.id;
      if (l.kind === 'gear') addGearItem(ctx, userId, ref, ctx.clock.now());
      else if (l.kind === 'consumable') addConsumable(ctx, userId, ref, qty);
      else updatePlayer(ctx, userId, { cage_capacity: requirePlayer(ctx, userId).cage_capacity + BALANCE.cage.upgradeStep });
      return left;
    })();
    const notices = ctx.bus.emit({ type: 'coins_spent', userId, amount: total, reason: `shop:${l.id}` }, ctx);
    return { ok: true, entry, qty, spent: total, coins, notices };
  } catch (err) {
    if (err instanceof InsufficientFundsError) return { ok: false, reason: 'funds', entry, required: total, available: err.available };
    throw err;
  }
}

// ───────────────────────── gear ─────────────────────────

export interface OwnedGear {
  item: GearItemRow;
  def: GearDef;
  equipped: boolean;
}

export function listOwnedGear(ctx: GameContext, userId: string): OwnedGear[] {
  const eq = getEquippedItems(ctx, userId);
  const equippedIds = new Set(Object.values(eq).map((r) => r!.id));
  const out: OwnedGear[] = [];
  for (const item of listGearItems(ctx, userId)) {
    const def = GEAR_BY_ID[item.gear_id];
    if (def) out.push({ item, def, equipped: equippedIds.has(item.id) });
  }
  return out;
}

export type EquipResult = { ok: true; def: GearDef; slot: GearSlot; previous: GearDef | null } | { ok: false; reason: 'not_owned' | 'unknown' | 'already' };

export function equipGear(ctx: GameContext, userId: string, gearItemId: number): EquipResult {
  ensurePlayerReady(ctx, userId);
  return ctx.db.transaction((): EquipResult => {
    const item = getGearItem(ctx, gearItemId);
    if (!item || item.user_id !== userId) return { ok: false, reason: 'not_owned' };
    const def = GEAR_BY_ID[item.gear_id];
    if (!def) return { ok: false, reason: 'unknown' };
    const cur = getEquippedItems(ctx, userId)[def.slot];
    if (cur?.id === item.id) return { ok: false, reason: 'already' };
    setEquipped(ctx, userId, def.slot, item.id);
    return { ok: true, def, slot: def.slot, previous: cur ? (GEAR_BY_ID[cur.gear_id] ?? null) : null };
  })();
}

export type UpgradeResult =
  | { ok: true; def: GearDef; gearItemId: number; level: number; cost: number; coins: number; notices: Notice[] }
  | { ok: false; reason: 'no_gear' | 'max'; def?: GearDef; level?: number }
  | { ok: false; reason: 'funds'; def: GearDef; level: number; cost: number; available: number };

/** Upgrade preview for the equipped item in a slot. */
export function upgradeInfo(ctx: GameContext, userId: string, slot: GearSlot): { def: GearDef; item: GearItemRow; cost: number | null } | null {
  const item = getEquippedItems(ctx, userId)[slot];
  const def = item ? GEAR_BY_ID[item.gear_id] : undefined;
  if (!item || !def) return null;
  return { def, item, cost: upgradeCost(def.tier, item.upgrade) };
}

/** /upgrade <slot>: +1 level (max 5) for the equipped item; cost = baseCost[tier] × growth^level. */
export function upgradeGear(ctx: GameContext, userId: string, slot: GearSlot): UpgradeResult {
  ensurePlayerReady(ctx, userId);
  const info = upgradeInfo(ctx, userId, slot);
  if (!info) return { ok: false, reason: 'no_gear' };
  const { def, item, cost } = info;
  if (cost === null) return { ok: false, reason: 'max', def, level: item.upgrade };
  try {
    const coins = ctx.db.transaction(() => {
      const fresh = getGearItem(ctx, item.id);
      if (!fresh || fresh.upgrade !== item.upgrade) throw new Error('gear changed during upgrade');
      const left = spendCoins(ctx, userId, cost);
      setGearUpgrade(ctx, item.id, item.upgrade + 1);
      return left;
    })();
    const level = item.upgrade + 1;
    const notices = [
      ...ctx.bus.emit({ type: 'gear_upgraded', userId, gearItemId: item.id, level }, ctx),
      ...ctx.bus.emit({ type: 'coins_spent', userId, amount: cost, reason: 'upgrade' }, ctx),
    ];
    return { ok: true, def, gearItemId: item.id, level, cost, coins, notices };
  } catch (err) {
    if (err instanceof InsufficientFundsError) return { ok: false, reason: 'funds', def, level: item.upgrade, cost, available: getBalance(ctx, userId).coins };
    throw err;
  }
}

// ───────────────────────── text helpers (shared by commands) ─────────────────────────

const STAT_LABELS: { key: keyof GearDef['stats']; label: (v: number) => string }[] = [
  { key: 'rarityBonus', label: (v) => `+${Math.round(v * 100)}% к редкости` },
  { key: 'biteWindowMs', label: (v) => `+${(v / 1000).toFixed(2)} с подсечки` },
  { key: 'weightBonus', label: (v) => `+${Math.round(v * 100)}% веса` },
  { key: 'reelTimeMs', label: (v) => `+${(v / 1000).toFixed(2)} с вываживания` },
  { key: 'reelMistakes', label: (v) => `+${Math.floor(v + 1e-9)} ошибк. вываживания` },
  { key: 'maxWeight', label: (v) => `до ${Math.round(v * 10) / 10} кг` },
  { key: 'maxEnergy', label: (v) => `+${Math.round(v)} ⚡ макс.` },
  { key: 'castCostReduction', label: (v) => `−${Math.round(v * 10) / 10} ⚡ за заброс` },
  { key: 'energyRegenBonus', label: (v) => `+${Math.round(v * 100)}% регенерации` },
];

/** "+5% к редкости · +0.10 с подсечки" for a gear item at an upgrade level. */
export function gearStatsText(def: GearDef, upgrade: number): string {
  const mult = 1 + BALANCE.upgrade.statBonusPerLevel * upgrade;
  const parts: string[] = [];
  for (const { key, label } of STAT_LABELS) {
    const v = def.stats[key];
    if (typeof v === 'number' && v > 0) parts.push(label(v * mult));
  }
  return parts.join(' · ');
}
