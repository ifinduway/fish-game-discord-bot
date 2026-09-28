// Auto-loads modules from a directory. Works for tsx (src/*.ts) and compiled output (dist/*.js).
// Ignored: *.d.ts, *.map, *.test.*, files starting with '_' or '.', non-code files (e.g. .gitkeep), subdirectories.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { EventBus } from './events.js';

export interface LoadedModule<T = unknown> {
  file: string;
  module: T;
}

const CODE_EXT = /\.(ts|mts|js|mjs)$/;

export function isLoadableFile(name: string): boolean {
  if (name.startsWith('_') || name.startsWith('.')) return false;
  if (name.endsWith('.d.ts') || name.endsWith('.d.mts') || name.endsWith('.map')) return false;
  if (name.includes('.test.') || name.includes('.spec.')) return false;
  return CODE_EXT.test(name);
}

function toPath(dir: string | URL): string {
  return dir instanceof URL ? fileURLToPath(dir) : dir;
}

/** Imports every loadable module in `dir` (sorted by file name). A missing directory yields []. */
export async function loadModules<T = unknown>(dir: string | URL): Promise<LoadedModule<T>[]> {
  const path = toPath(dir);
  if (!existsSync(path)) return [];
  const files = readdirSync(path)
    .filter((f) => isLoadableFile(f) && statSync(join(path, f)).isFile())
    .sort();
  const out: LoadedModule<T>[] = [];
  for (const f of files) {
    const full = join(path, f);
    const module = (await import(pathToFileURL(full).href)) as T;
    out.push({ file: full, module });
  }
  return out;
}

export const SUBSCRIBERS_DIR = new URL('../subscribers/', import.meta.url);

/** Loads every src/subscribers module and calls its default `register(bus)`. Returns loaded file names. */
export async function loadSubscribers(bus: EventBus, dir: string | URL = SUBSCRIBERS_DIR): Promise<string[]> {
  const mods = await loadModules<{ default?: (bus: EventBus) => void }>(dir);
  const names: string[] = [];
  for (const { file, module } of mods) {
    if (typeof module.default !== 'function') {
      console.warn(`[loader] subscriber ${file} has no default register(bus) export — skipped`);
      continue;
    }
    module.default(bus);
    names.push(file);
  }
  return names;
}
