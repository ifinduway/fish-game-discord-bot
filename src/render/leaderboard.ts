// Leaderboard card (§4.6 renderLeaderboardCard). 900×(header + up to 10 rows).
import { createCanvas } from '@napi-rs/canvas';
import type { LeaderboardCardData } from './types.js';
import { drawAvatar, drawCardBackground, drawPanel, drawTitle, drawTrophyIcon, font, PALETTE, roundRectPath, truncateToWidth, watermark, withGlow } from './common.js';

const W = 900;
const HEADER_H = 108;
const ROW_H = 62;
const FOOTER_H = 30;

const MEDAL_COLORS = ['#f4d160', '#c9d3dc', '#d3925a'];

export async function renderLeaderboardCardImpl(d: LeaderboardCardData): Promise<Buffer> {
  const rows = d.rows.slice(0, 10);
  const H = HEADER_H + Math.max(1, rows.length) * ROW_H + FOOTER_H;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');

  drawCardBackground(g, W, H, 24, { colors: [PALETTE.bgDeepNavy, PALETTE.bgTeal], seed: 2 });

  const pad = 32;
  withGlow(g, 'rgba(244, 209, 96, 0.55)', 16, () => {
    drawTrophyIcon(g, pad + 20, 40, 34, PALETTE.gold);
  });
  drawTitle(g, d.title, pad + 46, 52, 30);
  if (d.subtitle) {
    g.fillStyle = PALETTE.textSecondary;
    g.font = font(15, 'regular');
    g.fillText(d.subtitle, pad + 46, 78);
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const y = HEADER_H + i * ROW_H + 8;
    const rowH = ROW_H - 12;
    const highlighted = d.highlightUserId && row.userId === d.highlightUserId;

    if (highlighted) {
      g.save();
      g.fillStyle = 'rgba(56, 208, 224, 0.14)';
      g.strokeStyle = 'rgba(56, 208, 224, 0.55)';
      g.lineWidth = 1.5;
      const rr = 14;
      roundRectPath(g, pad, y, W - pad * 2, rowH, rr);
      g.fill();
      roundRectPath(g, pad + 0.75, y + 0.75, W - pad * 2 - 1.5, rowH - 1.5, rr);
      g.stroke();
      g.restore();
    } else {
      drawPanel(g, pad, y, W - pad * 2, rowH, 14);
    }

    // rank
    const rankX = pad + 34;
    const rankCy = y + rowH / 2;
    if (row.rank <= 3) {
      g.fillStyle = MEDAL_COLORS[row.rank - 1]!;
      g.beginPath();
      g.arc(rankX, rankCy, 20, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1c1c1c';
      g.font = font(17, 'bold');
    } else {
      g.fillStyle = PALETTE.textSecondary;
      g.font = font(17, 'bold');
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(row.rank), rankX, rankCy + 1);
    g.textBaseline = 'alphabetic';

    // avatar
    const avatarR = 20;
    const avatarCx = rankX + 46;
    // eslint-disable-next-line no-await-in-loop
    await drawAvatar(g, avatarCx, rankCy, avatarR, row.avatarUrl, row.username);

    // username
    g.fillStyle = PALETTE.textPrimary;
    g.font = font(18, 'bold');
    g.textAlign = 'left';
    g.fillText(truncateToWidth(g, row.username, W - pad * 2 - 300), avatarCx + avatarR + 18, rankCy + 6);

    // value
    g.fillStyle = highlighted ? '#7fe9f2' : PALETTE.textPrimary;
    g.font = font(19, 'bold');
    g.textAlign = 'right';
    g.fillText(row.value, W - pad - 20, rankCy + 6);
    g.textAlign = 'left';
  }

  if (rows.length === 0) {
    g.fillStyle = PALETTE.textMuted;
    g.font = font(16, 'regular');
    g.textAlign = 'center';
    g.fillText('Пока никто не участвует', W / 2, HEADER_H + ROW_H / 2);
    g.textAlign = 'left';
  }

  watermark(g, W, H);
  return canvas.encode('png');
}
