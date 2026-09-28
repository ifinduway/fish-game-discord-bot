// Season summary card (§4.6 renderSeasonSummaryCard). 1000×dynamic.
import { createCanvas } from '@napi-rs/canvas';
import type { SeasonSummaryData } from './types.js';
import { drawCardBackground, drawPanel, drawTitle, font, PALETTE, truncateToWidth, watermark } from './common.js';

const W = 1000;
const HEADER_H = 116;
const CAT_HEADER_H = 44;
const WINNER_ROW_H = 40;
const FOOTER_H = 36;
const GAP = 20;
const COLS = 2;

const MEDAL = ['🥇', '🥈', '🥉'];

export async function renderSeasonSummaryCardImpl(d: SeasonSummaryData): Promise<Buffer> {
  const cats = d.categories.slice(0, 8);
  const colCount = Math.min(COLS, Math.max(1, cats.length));
  const perCol = Math.ceil(cats.length / colCount);

  const colHeights: number[] = new Array(colCount).fill(0);
  cats.forEach((c, i) => {
    const col = Math.floor(i / perCol);
    colHeights[col] = (colHeights[col] ?? 0) + CAT_HEADER_H + Math.max(1, c.winners.length) * WINNER_ROW_H + GAP;
  });
  const bodyH = Math.max(120, ...colHeights);
  const H = HEADER_H + bodyH + FOOTER_H;

  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');

  drawCardBackground(g, W, H, 24, { colors: d.colors, seed: 13 });

  const pad = 32;
  drawTitle(g, `${d.emoji ?? '🏁'} ${d.seasonName}`, pad, 58, 32);
  g.fillStyle = PALETTE.textSecondary;
  g.font = font(15, 'regular');
  g.fillText('Итоги сезона', pad, 86);

  const colW = (W - pad * 2 - GAP * (colCount - 1)) / colCount;
  const colY: number[] = new Array(colCount).fill(HEADER_H);

  cats.forEach((cat, i) => {
    const col = Math.floor(i / perCol);
    const x = pad + col * (colW + GAP);
    let y = colY[col]!;
    const winners = cat.winners.slice(0, 5);
    const h = CAT_HEADER_H + Math.max(1, winners.length) * WINNER_ROW_H;

    drawPanel(g, x, y, colW, h, 16);
    g.fillStyle = PALETTE.textPrimary;
    g.font = font(17, 'bold');
    g.textAlign = 'left';
    g.fillText(truncateToWidth(g, cat.title, colW - 32), x + 16, y + 28);

    winners.forEach((w, wi) => {
      const wy = y + CAT_HEADER_H + wi * WINNER_ROW_H + 26;
      g.fillStyle = wi < 3 ? PALETTE.textPrimary : PALETTE.textSecondary;
      g.font = font(14, wi === 0 ? 'bold' : 'regular');
      const medal = MEDAL[wi] ?? `${wi + 1}.`;
      g.fillText(`${medal} ${truncateToWidth(g, w.username, colW - 140)}`, x + 16, wy);
      g.textAlign = 'right';
      g.fillStyle = wi === 0 ? PALETTE.gold : PALETTE.textSecondary;
      g.fillText(w.value, x + colW - 16, wy);
      g.textAlign = 'left';
    });
    if (winners.length === 0) {
      g.fillStyle = PALETTE.textMuted;
      g.font = font(13, 'regular');
      g.fillText('Нет участников', x + 16, y + CAT_HEADER_H + 24);
    }

    colY[col] = y + h + GAP;
  });

  watermark(g, W, H);
  return canvas.encode('png');
}
