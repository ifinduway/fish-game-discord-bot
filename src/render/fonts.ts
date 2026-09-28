// Font loading for card rendering (WP6). Ships PT Sans (OFL, Cyrillic-native) in assets/fonts and registers it
// with @napi-rs/canvas at module load. Falls back to system fonts silently if the files are missing so the
// bot never crashes because of a packaging mistake.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts } from '@napi-rs/canvas';

/** Walk up from this file until a directory containing package.json is found (works for both src/ via tsx and dist/). */
function findProjectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const ROOT = findProjectRoot();
const FONTS_DIR = join(ROOT, 'assets', 'fonts');

export const FONT_FAMILY_REGULAR = 'Card Sans';
export const FONT_FAMILY_BOLD = 'Card Sans';

let regularOk = false;
let boldOk = false;

function tryRegister(file: string, family: string): boolean {
  const path = join(FONTS_DIR, file);
  if (!existsSync(path)) return false;
  try {
    return !!GlobalFonts.registerFromPath(path, family);
  } catch (err) {
    console.error(`[render/fonts] failed to register ${file}:`, err);
    return false;
  }
}

regularOk = tryRegister('PTSans-Regular.ttf', FONT_FAMILY_REGULAR);
boldOk = tryRegister('PTSans-Bold.ttf', FONT_FAMILY_BOLD);

/** System fallback stack used whenever the shipped font failed to register. */
const FALLBACK_STACK = 'Segoe UI, Arial, DejaVu Sans, sans-serif';

/** Font-family token for canvas `ctx.font` strings, e.g. `font(20, 'bold')`. */
export function font(px: number, weight: 'regular' | 'bold' = 'regular'): string {
  const ok = weight === 'bold' ? boldOk : regularOk;
  const family = ok ? (weight === 'bold' ? FONT_FAMILY_BOLD : FONT_FAMILY_REGULAR) : FALLBACK_STACK;
  const w = weight === 'bold' ? 'bold ' : '';
  return `${w}${px}px ${family}`;
}

export const fontsReady = { regularOk, boldOk };
