// Boss card (§4.6 renderBossCard). 1000×500.
import { createCanvas } from '@napi-rs/canvas';
import type { BossCardData } from './types.js';
import { drawCardBackground, drawPanel, drawPinIcon, drawProgressBar, drawTitle, fmtDuration, fmtInt, font, PALETTE, roundRect, stripEmoji, truncateToWidth, watermark, withGlow, type Ctx } from './common.js';

const W = 1000;
const H = 500;

const STATUS_LABEL: Record<NonNullable<BossCardData['status']>, string> = {
  active: 'В бою',
  defeated: 'Повержен',
  expired: 'Сбежал',
};

export async function renderBossCardImpl(d: BossCardData): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');
  const status = d.status ?? 'active';

  drawCardBackground(g, W, H, 24, { colors: [PALETTE.bgDeepNavy, '#3a1414'], seed: 9 });

  const pad = 32;

  // silhouette blob behind title as a menacing presence
  withGlow(g, 'rgba(255,90,60,0.5)', 60, () => {
    g.fillStyle = 'rgba(255,80,50,0.18)';
    g.beginPath();
    g.ellipse(W - 190, 150, 170, 130, 0, 0, Math.PI * 2);
    g.fill();
  });
  drawBossSilhouette(g, W - 190, 150, 150);

  drawTitle(g, d.name, pad, 66, 34);
  drawPinIcon(g, pad + 6, 89, 14, PALETTE.textSecondary);
  g.fillStyle = PALETTE.textSecondary;
  g.font = font(16, 'regular');
  g.fillText(stripEmoji(d.location), pad + 18, 94);

  const statusColor = status === 'active' ? '#ff8c1a' : status === 'defeated' ? '#4caf50' : '#9e9e9e';
  g.font = font(13, 'bold');
  const label = STATUS_LABEL[status].toUpperCase();
  const tw = g.measureText(label).width + 26;
  g.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(g, pad, 108, tw, 28, 14);
  g.fillStyle = statusColor;
  g.textAlign = 'center';
  g.fillText(label, pad + tw / 2, 127);
  g.textAlign = 'left';

  // HP bar
  const barY = 190;
  const barW = W - pad * 2;
  g.fillStyle = PALETTE.textSecondary;
  g.font = font(15, 'regular');
  g.fillText('Здоровье босса', pad, barY - 12);
  g.textAlign = 'right';
  g.fillText(`${fmtInt(d.hp)} / ${fmtInt(d.maxHp)}`, pad + barW, barY - 12);
  g.textAlign = 'left';
  drawProgressBar(g, pad, barY, barW, 22, d.maxHp > 0 ? d.hp / d.maxHp : 0, PALETTE.bossHp);

  if (status === 'active') {
    const remainingMs = d.expiresAt - Date.now();
    const timeText = remainingMs > 0 ? `Осталось ${fmtDuration(remainingMs)}` : 'Истекает…';
    g.fillStyle = PALETTE.textMuted;
    g.font = font(13, 'regular');
    g.textAlign = 'right';
    g.fillText(timeText, pad + barW, barY + 42);
    g.textAlign = 'left';
  }

  // top contributors
  const topY = barY + 66;
  const topH = H - topY - pad;
  drawPanel(g, pad, topY, W - pad * 2, topH, 16);
  g.fillStyle = PALETTE.textPrimary;
  g.font = font(16, 'bold');
  g.fillText('Лучшие охотники', pad + 18, topY + 28);

  const top = d.top.slice(0, 5);
  const rowH = Math.min(40, (topH - 44) / Math.max(1, top.length));
  const maxDmg = Math.max(1, ...top.map((t) => t.damage));
  top.forEach((t, i) => {
    const y = topY + 44 + i * rowH;
    g.fillStyle = PALETTE.textSecondary;
    g.font = font(14, 'bold');
    g.fillText(`${i + 1}.`, pad + 18, y + 18);
    g.fillStyle = PALETTE.textPrimary;
    g.font = font(15, 'regular');
    g.fillText(truncateToWidth(g, t.username, 260), pad + 44, y + 18);

    const barX = pad + 320;
    const barMaxW = W - pad * 2 - 320 - 110;
    drawProgressBar(g, barX, y + 6, barMaxW, 12, t.damage / maxDmg, ['#ff8c1a', '#ffce54']);
    g.fillStyle = PALETTE.textPrimary;
    g.font = font(14, 'bold');
    g.textAlign = 'right';
    g.fillText(fmtInt(t.damage), pad + 18 + (W - pad * 2 - 36), y + 18);
    g.textAlign = 'left';
  });
  if (top.length === 0) {
    g.fillStyle = PALETTE.textMuted;
    g.font = font(14, 'regular');
    g.fillText('Пока никто не атаковал', pad + 18, topY + 60);
  }

  watermark(g, W, H);
  return canvas.encode('png');
}

function drawBossSilhouette(g: Ctx, cx: number, cy: number, size: number): void {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = 'rgba(80, 20, 20, 0.85)';
  // bulbous head
  g.beginPath();
  g.ellipse(0, -size * 0.1, size * 0.42, size * 0.36, 0, 0, Math.PI * 2);
  g.fill();
  // tentacles
  for (let i = -3; i <= 3; i++) {
    const x0 = i * size * 0.12;
    g.beginPath();
    g.moveTo(x0, size * 0.15);
    g.quadraticCurveTo(x0 + Math.sin(i) * 14, size * 0.5, x0 * 1.4, size * 0.62 + Math.abs(i) * 6);
    g.lineWidth = size * 0.07;
    g.strokeStyle = 'rgba(80, 20, 20, 0.85)';
    g.lineCap = 'round';
    g.stroke();
  }
  // eyes
  g.fillStyle = '#ffde59';
  g.beginPath();
  g.arc(-size * 0.14, -size * 0.14, size * 0.06, 0, Math.PI * 2);
  g.arc(size * 0.14, -size * 0.14, size * 0.06, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a0505';
  g.beginPath();
  g.arc(-size * 0.14, -size * 0.14, size * 0.028, 0, Math.PI * 2);
  g.arc(size * 0.14, -size * 0.14, size * 0.028, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
