// Shared drawing helpers for all cards (WP6): rounded rects, gradients, avatars, progress bars, vector icons,
// rarity glow, ru-RU formatting. Nothing here talks to the network except `loadAvatar`, which never throws.
import { loadImage, type Image, type SKRSContext2D } from '@napi-rs/canvas';
import { RARITY_INFO, type Rarity } from '../data/types.js';
import { font } from './fonts.js';

export { font } from './fonts.js';
export type Ctx = SKRSContext2D;

// ---------- palette ----------
export const PALETTE = {
  bgDeepNavy: '#0a1628',
  bgTeal: '#0e3b4a',
  bgTealLight: '#134a5c',
  panel: 'rgba(8, 20, 34, 0.55)',
  panelBorder: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#eef6fa',
  textSecondary: '#9fb8c8',
  textMuted: '#6e8494',
  energy: '#f5c542',
  xp: '#38d0e0',
  bossHp: ['#ff5e3a', '#ff8c1a'] as [string, string],
  pass: '#a06bff',
  gold: '#f2c14e',
  pearl: '#bfe8ea',
} as const;

export function rarityColor(r: Rarity): string {
  return `#${RARITY_INFO[r].color.toString(16).padStart(6, '0')}`;
}

export function rarityName(r: Rarity): string {
  return RARITY_INFO[r].name;
}

const intFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

/** ru-RU integer, e.g. "12 345" (thin-space grouped). */
export function fmtInt(n: number): string {
  return intFmt.format(Math.round(n));
}
/** ru-RU decimal (2 digits), e.g. "1,25". */
export function fmtDec(n: number): string {
  return decFmt.format(n);
}
export function fmtWeight(kg: number): string {
  return `${fmtDec(kg)} кг`;
}

/** Russian compact duration: "2 д 3 ч", "5 ч 12 мин", "4 мин 10 с", "45 с". Renderers must never bake Discord
 * timestamp markup (`<t:…:R>`) into a canvas card — it only resolves inside real Discord message content. */
export function fmtDuration(ms: number): string {
  let s = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return h > 0 ? `${d} д ${h} ч` : `${d} д`;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  if (m > 0) return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
  return `${s} с`;
}

// eslint-disable-next-line no-misleading-character-class
const EMOJI_RE = /[\u{1F1E6}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️]/gu;
/** Strips color emoji from externally-supplied strings (e.g. stakeLabel) — canvas cannot render them reliably;
 * vector icons (drawCoinIcon, drawFishIcon, …) are drawn separately where the meaning is known. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim();
}
export function stars(quality: number, max = 5): string {
  const q = Math.max(0, Math.min(max, Math.round(quality)));
  return '★'.repeat(q) + '☆'.repeat(max - q);
}

// ---------- basic shapes ----------
export function roundRectPath(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

export function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  roundRectPath(g, x, y, w, h, r);
  g.fill();
}

/** Clips to a rounded-rect region for the duration of `draw`, restoring state after. */
export function withClip(g: Ctx, x: number, y: number, w: number, h: number, r: number, draw: () => void): void {
  g.save();
  roundRectPath(g, x, y, w, h, r);
  g.clip();
  draw();
  g.restore();
}

/** Truncates text with an ellipsis so it fits within `maxWidth` at the currently set font. */
export function truncateToWidth(g: Ctx, text: string, maxWidth: number): string {
  if (g.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (g.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

// ---------- background ----------
/** Deep-water gradient card background with subtle wave bands and bubbles, clipped to a rounded card shape. */
export function drawCardBackground(
  g: Ctx,
  w: number,
  h: number,
  radius: number,
  opts: { colors?: [string, string]; seed?: number } = {},
): void {
  withClip(g, 0, 0, w, h, radius, () => {
    const [c1, c2] = opts.colors ?? [PALETTE.bgDeepNavy, PALETTE.bgTeal];
    const grad = g.createLinearGradient(0, 0, w * 0.3, h);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);

    // radial glow top-right
    const glow = g.createRadialGradient(w * 0.85, h * 0.1, 0, w * 0.85, h * 0.1, w * 0.6);
    glow.addColorStop(0, 'rgba(255,255,255,0.07)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);

    // wave bands near the bottom
    const seed = opts.seed ?? 7;
    g.globalAlpha = 0.08;
    g.fillStyle = '#ffffff';
    for (let b = 0; b < 2; b++) {
      const baseY = h - 40 - b * 26;
      g.beginPath();
      g.moveTo(0, baseY);
      const amp = 10 + b * 6;
      const step = 40;
      for (let x = 0; x <= w; x += step) {
        const t = (x / step) * 0.9 + b * 1.7 + seed;
        g.lineTo(x, baseY + Math.sin(t) * amp);
      }
      g.lineTo(w, h);
      g.lineTo(0, h);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 1;

    // bubbles
    let s = seed * 9301 + 49297;
    const rand = (): number => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let i = 0; i < 14; i++) {
      const bx = rand() * w;
      const by = rand() * h;
      const br = 1.5 + rand() * 4;
      g.beginPath();
      g.arc(bx, by, br, 0, Math.PI * 2);
      g.fill();
    }
  });

  // outer border
  g.strokeStyle = PALETTE.panelBorder;
  g.lineWidth = 2;
  roundRectPath(g, 1, 1, w - 2, h - 2, radius);
  g.stroke();
}

/** Translucent inner panel used to group content. */
export function drawPanel(g: Ctx, x: number, y: number, w: number, h: number, r = 16): void {
  g.fillStyle = PALETTE.panel;
  roundRect(g, x, y, w, h, r);
  g.strokeStyle = PALETTE.panelBorder;
  g.lineWidth = 1;
  roundRectPath(g, x + 0.5, y + 0.5, w - 1, h - 1, r);
  g.stroke();
}

/** Soft glow behind whatever is drawn inside `draw`, using `color`. */
export function withGlow(g: Ctx, color: string, blur: number, draw: () => void): void {
  g.save();
  g.shadowColor = color;
  g.shadowBlur = blur;
  draw();
  g.restore();
}

/** Rarity-colored border around a rect; mythic gets an animated-looking rainbow gradient border. */
export function drawRarityBorder(g: Ctx, x: number, y: number, w: number, h: number, r: number, rarity: Rarity, lineWidth = 3): void {
  g.save();
  g.lineWidth = lineWidth;
  if (rarity === 'mythic') {
    const grad = g.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#ff5e5e');
    grad.addColorStop(0.25, '#ffd45e');
    grad.addColorStop(0.5, '#5ef2a0');
    grad.addColorStop(0.75, '#5ec8ff');
    grad.addColorStop(1, '#c05eff');
    g.strokeStyle = grad;
    g.shadowColor = 'rgba(255,255,255,0.5)';
    g.shadowBlur = 14;
  } else {
    const color = rarityColor(rarity);
    g.strokeStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 12;
  }
  roundRectPath(g, x + lineWidth / 2, y + lineWidth / 2, w - lineWidth, h - lineWidth, r);
  g.stroke();
  g.restore();
}

// ---------- progress bars ----------
export function drawProgressBar(
  g: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  ratio: number,
  color: string | [string, string],
  opts: { track?: string } = {},
): void {
  const rr = h / 2;
  g.fillStyle = opts.track ?? 'rgba(255,255,255,0.08)';
  roundRect(g, x, y, w, h, rr);
  const fillW = Math.max(0, Math.min(1, ratio)) * w;
  if (fillW < 1) return;
  if (Array.isArray(color)) {
    const grad = g.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, color[0]);
    grad.addColorStop(1, color[1]);
    g.fillStyle = grad;
  } else {
    g.fillStyle = color;
  }
  roundRect(g, x, y, Math.max(fillW, rr * 2 > fillW ? fillW : fillW), h, rr);
}

// ---------- avatars ----------
/** Draws a circular avatar at (cx, cy) with given radius. Loads `url` with a timeout; falls back to an
 * initial-letter circle on any error/timeout — never throws. */
export async function drawAvatar(g: Ctx, cx: number, cy: number, radius: number, url: string | undefined, fallbackText: string): Promise<void> {
  let img: Image | null = null;
  if (url) {
    try {
      img = await withTimeout(loadImage(url), 3000);
    } catch {
      img = null;
    }
  }
  g.save();
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  if (img) {
    g.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    const grad = g.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    grad.addColorStop(0, '#2b6f7d');
    grad.addColorStop(1, '#123444');
    g.fillStyle = grad;
    g.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.font = font(Math.round(radius * 1.1), 'bold');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((fallbackText[0] ?? '?').toUpperCase(), cx, cy + radius * 0.05);
  }
  g.restore();
  g.beginPath();
  g.arc(cx, cy, radius, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 2;
  g.stroke();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ---------- vector icons (no color emoji reliance) ----------
/** Fish silhouette centered at (cx, cy), tip pointing right, `size` = length. */
export function drawFishIcon(g: Ctx, cx: number, cy: number, size: number, color: string): void {
  const s = size;
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-s * 0.5, 0);
  g.quadraticCurveTo(-s * 0.2, -s * 0.32, s * 0.32, -s * 0.14);
  g.quadraticCurveTo(s * 0.5, 0, s * 0.32, s * 0.14);
  g.quadraticCurveTo(-s * 0.2, s * 0.32, -s * 0.5, 0);
  g.closePath();
  g.fill();
  // tail
  g.beginPath();
  g.moveTo(-s * 0.46, 0);
  g.lineTo(-s * 0.7, -s * 0.22);
  g.lineTo(-s * 0.62, 0);
  g.lineTo(-s * 0.7, s * 0.22);
  g.closePath();
  g.fill();
  // eye
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath();
  g.arc(s * 0.24, -s * 0.04, s * 0.045, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function drawCoinIcon(g: Ctx, cx: number, cy: number, r: number): void {
  g.save();
  const grad = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#ffe9a8');
  grad.addColorStop(1, '#d99a1f');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#a86e10';
  g.lineWidth = Math.max(1, r * 0.12);
  g.stroke();
  g.fillStyle = 'rgba(140,90,10,0.8)';
  g.font = font(Math.round(r * 1.1), 'bold');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('₽', cx, cy + r * 0.05);
  g.restore();
}

export function drawPearlIcon(g: Ctx, cx: number, cy: number, r: number): void {
  g.save();
  const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.6, '#cfeef0');
  grad.addColorStop(1, '#8fc3c9');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Small rotated-square "gem" icon, used for generic items. */
export function drawDiamondIcon(g: Ctx, cx: number, cy: number, r: number, color: string = '#5ec8ff'): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.PI / 4);
  g.fillStyle = color;
  roundRect(g, -r * 0.7, -r * 0.7, r * 1.4, r * 1.4, r * 0.2);
  g.restore();
}

/** Four-point sparkle icon, used for cosmetics. */
export function drawSparkleIcon(g: Ctx, cx: number, cy: number, r: number, color: string = '#e0a8ff'): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, -r);
  g.quadraticCurveTo(r * 0.15, -r * 0.15, r, 0);
  g.quadraticCurveTo(r * 0.15, r * 0.15, 0, r);
  g.quadraticCurveTo(-r * 0.15, r * 0.15, -r, 0);
  g.quadraticCurveTo(-r * 0.15, -r * 0.15, 0, -r);
  g.closePath();
  g.fill();
  g.restore();
}

/** Simple cog icon, used for gear rewards. */
export function drawGearIcon(g: Ctx, cx: number, cy: number, r: number, color: string = '#9ab8c8'): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  const teeth = 8;
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / teeth / 2;
    g.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    g.lineTo(Math.cos(a1) * r * 0.72, Math.sin(a1) * r * 0.72);
  }
  g.closePath();
  g.fill();
  g.fillStyle = PALETTE.bgDeepNavy;
  g.beginPath();
  g.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Location pin icon (map marker teardrop). */
export function drawPinIcon(g: Ctx, cx: number, cy: number, size: number, color: string = PALETTE.textSecondary): void {
  const s = size;
  g.save();
  g.translate(cx, cy - s * 0.5);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, s);
  g.bezierCurveTo(-s * 0.55, s * 0.35, -s * 0.5, -s * 0.35, 0, -s * 0.5);
  g.bezierCurveTo(s * 0.5, -s * 0.35, s * 0.55, s * 0.35, 0, s);
  g.closePath();
  g.fill();
  g.fillStyle = PALETTE.bgDeepNavy;
  g.beginPath();
  g.arc(0, -s * 0.12, s * 0.2, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Small trophy icon (cup + stem + base). */
export function drawTrophyIcon(g: Ctx, cx: number, cy: number, size: number, color: string = PALETTE.gold): void {
  const s = size;
  g.save();
  g.translate(cx - s * 0.5, cy - s * 0.5);
  g.fillStyle = color;
  roundRect(g, s * 0.2, 0, s * 0.6, s * 0.5, s * 0.06);
  g.strokeStyle = color;
  g.lineWidth = s * 0.08;
  g.beginPath();
  g.arc(s * 0.2, s * 0.12, s * 0.16, Math.PI * 0.3, Math.PI * 1.6, true);
  g.stroke();
  g.beginPath();
  g.arc(s * 0.8, s * 0.12, s * 0.16, Math.PI * 1.4, Math.PI * 0.7);
  g.stroke();
  g.fillRect(s * 0.42, s * 0.5, s * 0.16, s * 0.22);
  roundRect(g, s * 0.28, s * 0.7, s * 0.44, s * 0.12, s * 0.04);
  g.restore();
}

function starPath(g: Ctx, cx: number, cy: number, outerR: number, innerR: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

/** Single 5-point star (neither PT Sans nor generic sans-serif ship ★/☆ on all platforms). */
export function drawStarIcon(g: Ctx, cx: number, cy: number, outerR: number, filled: boolean, color = PALETTE.energy): void {
  g.save();
  starPath(g, cx, cy, outerR, outerR * 0.42);
  if (filled) {
    g.fillStyle = color;
    g.fill();
  } else {
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = Math.max(1, outerR * 0.14);
    g.stroke();
  }
  g.restore();
}

/** Centered row of `max` stars, first `quality` filled. Returns the row's total width. */
export function drawStarRow(g: Ctx, cx: number, cy: number, quality: number, max: number, outerR: number): number {
  const diameter = outerR * 2;
  const gap = outerR * 0.7;
  const total = max * diameter + (max - 1) * gap;
  const startCx = cx - total / 2 + outerR;
  const q = Math.max(0, Math.min(max, Math.round(quality)));
  for (let i = 0; i < max; i++) {
    drawStarIcon(g, startCx + i * (diameter + gap), cy, outerR, i < q, PALETTE.energy);
  }
  return total;
}

/** Card-suit vector glyph (neither PT Sans nor generic sans-serif ship ♠♥♦♣ on all platforms). */
export function drawSuitIcon(g: Ctx, cx: number, cy: number, size: number, suit: '♠' | '♥' | '♦' | '♣', color?: string): void {
  const s = size;
  color ??= suitColor(suit);
  g.save();
  g.translate(cx, cy);
  g.fillStyle = color;
  if (suit === '♦') {
    g.beginPath();
    g.moveTo(0, -s * 0.55);
    g.lineTo(s * 0.4, 0);
    g.lineTo(0, s * 0.55);
    g.lineTo(-s * 0.4, 0);
    g.closePath();
    g.fill();
  } else if (suit === '♥') {
    drawHeartPath(g, s);
    g.fill();
  } else if (suit === '♠') {
    g.save();
    g.scale(1, -1);
    drawHeartPath(g, s * 0.95);
    g.fill();
    g.restore();
    g.fillRect(-s * 0.06, s * 0.05, s * 0.12, s * 0.3);
  } else {
    const lobeR = s * 0.26;
    g.beginPath();
    g.arc(0, -lobeR * 0.9, lobeR, 0, Math.PI * 2);
    g.arc(-lobeR * 0.9, lobeR * 0.5, lobeR, 0, Math.PI * 2);
    g.arc(lobeR * 0.9, lobeR * 0.5, lobeR, 0, Math.PI * 2);
    g.fill();
    g.fillRect(-s * 0.06, lobeR * 0.3, s * 0.12, s * 0.32);
  }
  g.restore();
}

function drawHeartPath(g: Ctx, s: number): void {
  g.beginPath();
  g.moveTo(0, s * 0.5);
  g.bezierCurveTo(-s * 0.65, -s * 0.05, -s * 0.35, -s * 0.55, 0, -s * 0.18);
  g.bezierCurveTo(s * 0.35, -s * 0.55, s * 0.65, -s * 0.05, 0, s * 0.5);
  g.closePath();
}

export function drawEnergyIcon(g: Ctx, cx: number, cy: number, size: number, color = PALETTE.energy): void {
  const s = size;
  g.save();
  g.translate(cx - s * 0.28, cy - s * 0.5);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(s * 0.55, 0);
  g.lineTo(s * 0.05, s * 0.58);
  g.lineTo(s * 0.32, s * 0.58);
  g.lineTo(s * 0.1, s);
  g.lineTo(s * 0.62, s * 0.4);
  g.lineTo(s * 0.34, s * 0.4);
  g.closePath();
  g.fill();
  g.restore();
}

export function drawChestIcon(g: Ctx, cx: number, cy: number, size: number, color: string): void {
  const w = size;
  const h = size * 0.72;
  g.save();
  g.translate(cx - w / 2, cy - h / 2);
  g.fillStyle = color;
  roundRect(g, 0, h * 0.32, w, h * 0.68, 4);
  g.fillStyle = shade(color, -20);
  roundRectPath(g, 0, 0, w, h * 0.4, 4);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, h * 0.3, w, h * 0.08);
  g.fillStyle = '#e8c65c';
  roundRect(g, w / 2 - w * 0.06, h * 0.28, w * 0.12, h * 0.24, 3);
  g.restore();
}

function shade(hex: string, percent: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + percent));
  const gC = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + percent));
  const b = Math.min(255, Math.max(0, (n & 0xff) + percent));
  return `#${((1 << 24) + (r << 16) + (gC << 8) + b).toString(16).slice(1)}`;
}

// ---------- playing cards ----------
export function suitColor(suit: '♠' | '♥' | '♦' | '♣'): string {
  return suit === '♥' || suit === '♦' ? '#e94b5c' : '#eef6fa';
}

/** Draws a playing card face at (x, y) sized (w, h). */
export function drawPlayingCard(g: Ctx, x: number, y: number, w: number, h: number, rank: string, suit: '♠' | '♥' | '♦' | '♣'): void {
  g.save();
  g.fillStyle = '#f4f1e9';
  roundRect(g, x, y, w, h, 10);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 1.5;
  roundRectPath(g, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 10);
  g.stroke();

  const color = suit === '♥' || suit === '♦' ? '#c62839' : '#1c1c1c';
  g.fillStyle = color;
  g.textBaseline = 'top';
  g.textAlign = 'left';
  g.font = font(Math.round(w * 0.22), 'bold');
  g.fillText(rank, x + w * 0.08, y + h * 0.05);
  drawSuitIcon(g, x + w * 0.08 + w * 0.09, y + h * 0.28 + w * 0.09, w * 0.16, suit, color);

  drawSuitIcon(g, x + w / 2, y + h / 2 + h * 0.02, w * 0.42, suit, color);

  g.save();
  g.translate(x + w * 0.92, y + h * 0.95);
  g.rotate(Math.PI);
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.font = font(Math.round(w * 0.22), 'bold');
  g.fillText(rank, 0, 0);
  g.restore();
  g.restore();
}

/** Face-down card with a diamond hatch pattern. */
export function drawCardBack(g: Ctx, x: number, y: number, w: number, h: number): void {
  g.save();
  roundRectPath(g, x, y, w, h, 10);
  g.clip();
  const grad = g.createLinearGradient(x, y, x + w, y + h);
  grad.addColorStop(0, '#1c3d63');
  grad.addColorStop(1, '#0d2038');
  g.fillStyle = grad;
  g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 1;
  const step = 10;
  for (let i = -h; i < w + h; i += step) {
    g.beginPath();
    g.moveTo(x + i, y);
    g.lineTo(x + i + h, y + h);
    g.stroke();
  }
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 1.5;
  roundRectPath(g, x + 0.75, y + 0.75, w - 1.5, h - 1.5, 10);
  g.stroke();
}

// ---------- header/footer chrome ----------
export function drawTitle(g: Ctx, text: string, x: number, y: number, size: number, color: string = PALETTE.textPrimary, align: 'left' | 'center' | 'right' = 'left'): void {
  g.fillStyle = color;
  g.font = font(size, 'bold');
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, y);
  g.textAlign = 'left';
}

export function drawLabel(g: Ctx, text: string, x: number, y: number, size = 16, color: string = PALETTE.textSecondary): void {
  g.fillStyle = color;
  g.font = font(size, 'regular');
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(text, x, y);
}

export function watermark(g: Ctx, w: number, h: number): void {
  g.save();
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.font = font(13, 'regular');
  g.textAlign = 'right';
  g.textBaseline = 'bottom';
  g.fillText('Рыбалка', w - 18, h - 14);
  drawFishIcon(g, w - 18 - g.measureText('Рыбалка').width - 16, h - 19, 20, 'rgba(255,255,255,0.28)');
  g.restore();
}
