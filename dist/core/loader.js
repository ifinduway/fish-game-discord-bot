// Auto-loads modules from a directory. Works for tsx (src/*.ts) and compiled output (dist/*.js).
// Ignored: *.d.ts, *.map, *.test.*, files starting with '_' or '.', non-code files (e.g. .gitkeep), subdirectories.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const CODE_EXT = /\.(ts|mts|js|mjs)$/;
export function isLoadableFile(name) {
    if (name.startsWith('_') || name.startsWith('.'))
        return false;
    if (name.endsWith('.d.ts') || name.endsWith('.d.mts') || name.endsWith('.map'))
        return false;
    if (name.includes('.test.') || name.includes('.spec.'))
        return false;
    return CODE_EXT.test(name);
}
function toPath(dir) {
    return dir instanceof URL ? fileURLToPath(dir) : dir;
}
/** Imports every loadable module in `dir` (sorted by file name). A missing directory yields []. */
export async function loadModules(dir) {
    const path = toPath(dir);
    if (!existsSync(path))
        return [];
    const files = readdirSync(path)
        .filter((f) => isLoadableFile(f) && statSync(join(path, f)).isFile())
        .sort();
    const out = [];
    for (const f of files) {
        const full = join(path, f);
        const module = (await import(pathToFileURL(full).href));
        out.push({ file: full, module });
    }
    return out;
}
export const SUBSCRIBERS_DIR = new URL('../subscribers/', import.meta.url);
/** Loads every src/subscribers module and calls its default `register(bus)`. Returns loaded file names. */
export async function loadSubscribers(bus, dir = SUBSCRIBERS_DIR) {
    const mods = await loadModules(dir);
    const names = [];
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
//# sourceMappingURL=loader.js.map