// Collection (encyclopedia), species server records and location overview (WP2).
import type { GameContext } from '../core/context.js';
import { FISH, FISH_BY_ID } from '../data/fish.js';
import { LOCATIONS } from '../data/locations.js';
import type { FishSpecies, LocationDef, LocationId } from '../data/types.js';
import { prepare, type DbCtx } from '../db/database.js';
import { getPlayer } from '../db/repos/players.js';

export interface CollectionRow {
  species_id: string;
  first_caught_at: number;
  count: number;
  best_weight: number;
  best_quality: number;
}

export interface SpeciesRecordRow {
  species_id: string;
  user_id: string;
  weight: number;
  caught_at: number;
}

/**
 * Upserts the collection entry for a catch (count, best weight/quality). Must run inside the caller's transaction.
 * Returns true if this is the player's first catch of the species.
 */
export function recordCollection(ctx: DbCtx, userId: string, speciesId: string, weight: number, quality: number, at: number): boolean {
  const existed = prepare(ctx.db, 'SELECT 1 FROM collection WHERE user_id = ? AND species_id = ?').get(userId, speciesId) !== undefined;
  prepare(
    ctx.db,
    `INSERT INTO collection (user_id, species_id, first_caught_at, count, best_weight, best_quality) VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id, species_id) DO UPDATE SET count = count + 1,
       best_weight = MAX(best_weight, excluded.best_weight), best_quality = MAX(best_quality, excluded.best_quality)`,
  ).run(userId, speciesId, at, weight, quality);
  return !existed;
}

/** Updates the server record for a species if `weight` beats it (or none exists). Returns true on a new record. */
export function updateSpeciesRecord(ctx: DbCtx, speciesId: string, userId: string, weight: number, at: number): boolean {
  const r = prepare(
    ctx.db,
    `INSERT INTO species_records (species_id, user_id, weight, caught_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(species_id) DO UPDATE SET user_id = excluded.user_id, weight = excluded.weight, caught_at = excluded.caught_at
     WHERE excluded.weight > species_records.weight`,
  ).run(speciesId, userId, weight, at);
  return r.changes > 0;
}

export function getSpeciesRecord(ctx: DbCtx, speciesId: string): SpeciesRecordRow | undefined {
  return prepare(ctx.db, 'SELECT * FROM species_records WHERE species_id = ?').get(speciesId) as SpeciesRecordRow | undefined;
}

export function listCollection(ctx: DbCtx, userId: string): CollectionRow[] {
  return prepare(ctx.db, 'SELECT species_id, first_caught_at, count, best_weight, best_quality FROM collection WHERE user_id = ?').all(userId) as CollectionRow[];
}

/** Caught species (known to the catalog) / all catalog species. */
export function collectionProgress(ctx: DbCtx, userId: string): { caught: number; total: number } {
  const caught = listCollection(ctx, userId).filter((r) => FISH_BY_ID[r.species_id]).length;
  return { caught, total: FISH.length };
}

export function speciesAtLocation(location: LocationId): FishSpecies[] {
  return FISH.filter((f) => f.locations.includes(location));
}

export interface CollectionEntry {
  species: FishSpecies;
  caught: CollectionRow | null;
}

export interface CollectionPage {
  location: LocationDef;
  entries: CollectionEntry[];
  caught: number;
  total: number;
}

/** Encyclopedia page for one location (species ordered by rarity then name). */
export function getCollectionPage(ctx: DbCtx, userId: string, location: LocationId): CollectionPage {
  const loc = LOCATIONS.find((l) => l.id === location) ?? LOCATIONS[0]!;
  const byId = new Map(listCollection(ctx, userId).map((r) => [r.species_id, r]));
  const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
  const species = speciesAtLocation(loc.id).sort((a, b) => order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name, 'ru'));
  const entries = species.map((s) => ({ species: s, caught: byId.get(s.id) ?? null }));
  return { location: loc, entries, caught: entries.filter((e) => e.caught).length, total: entries.length };
}

export interface LocationOverview {
  location: LocationDef;
  unlocked: boolean;
  caught: number;
  total: number;
  current: boolean;
}

export function locationsOverview(ctx: GameContext, userId: string): LocationOverview[] {
  const p = getPlayer(ctx, userId);
  const level = p?.level ?? 1;
  const caughtIds = new Set(listCollection(ctx, userId).map((r) => r.species_id));
  return LOCATIONS.map((location) => {
    const species = speciesAtLocation(location.id);
    return {
      location,
      unlocked: level >= location.unlockLevel,
      caught: species.filter((s) => caughtIds.has(s.id)).length,
      total: species.length,
      current: (p?.location ?? 'pond') === location.id,
    };
  });
}
