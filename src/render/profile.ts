// Profile card (§4.6 renderProfileCard). 1000×560.
import { createCanvas } from '@napi-rs/canvas';
import { RARITY_INFO } from '../data/types.js';
import type { ProfileCardData } from './types.js';
import {
  drawAvatar,
  drawCardBackground,
  drawCoinIcon,
  drawEnergyIcon,
  drawPanel,
  drawPearlIcon,
  drawProgressBar,
  drawTitle,
  fmtInt,
  font,
  PALETTE,
  rarityColor,
  roundRect,
  truncateToWidth,
  watermark,
  type Ctx,
} from './common.js';

const W = 1000;
const H = 560;

function resolveFill(g: Ctx, spec: { color?: string; gradient?: [string, string] } | undefined, x1: number, y1: number, x2: number, y2: number, fallback: string) {
  if (spec?.gradient) {
    const grad = g.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, spec.gradient[0]);
    grad.addColorStop(1, spec.gradient[1]);
    return grad;
  }
  if (spec?.color) return spec.color;
  return fallback;
}

export async function renderProfileCardImpl(d: ProfileCardData): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');

  const bgColors: [string, string] = d.background?.gradient ?? (d.background?.color ? [d.background.color, PALETTE.bgTeal] : [PALETTE.bgDeepNavy, PALETTE.bgTeal]);
  drawCardBackground(g, W, H, 24, { colors: bgColors, seed: 3 });

  const pad = 32;

  // ---- header: avatar + name/level/title ----
  const avatarR = 58;
  const avatarCx = pad + avatarR;
  const avatarCy = pad + avatarR + 4;

  if (d.frame) {
    const frameColor = resolveFill(g, d.frame, avatarCx - avatarR, avatarCy - avatarR, avatarCx + avatarR, avatarCy + avatarR, '#ffd45e');
    g.save();
    g.beginPath();
    g.arc(avatarCx, avatarCy, avatarR + 6, 0, Math.PI * 2);
    g.lineWidth = 5;
    g.strokeStyle = frameColor;
    g.shadowColor = typeof frameColor === 'string' ? frameColor : 'rgba(255,255,255,0.5)';
    g.shadowBlur = 14;
    g.stroke();
    g.restore();
  }
  await drawAvatar(g, avatarCx, avatarCy, avatarR, d.avatarUrl, d.username);

  const nameX = avatarCx + avatarR + 26;
  drawTitle(g, truncateToWidth(g, d.username, W - nameX - 260), nameX, pad + 34, 32);

  g.fillStyle = PALETTE.textSecondary;
  g.font = font(18, 'regular');
  g.textAlign = 'left';
  const levelLine = `Уровень ${d.level}${d.title ? `  ·  ${d.title}` : ''}`;
  g.fillText(truncateToWidth(g, levelLine, W - nameX - 260), nameX, pad + 62);

  // level badge (right side of header)
  const badgeR = 34;
  const badgeCx = W - pad - badgeR;
  const badgeCy = pad + badgeR;
  const badgeGrad = g.createLinearGradient(badgeCx - badgeR, badgeCy - badgeR, badgeCx + badgeR, badgeCy + badgeR);
  badgeGrad.addColorStop(0, '#38d0e0');
  badgeGrad.addColorStop(1, '#1b6f7d');
  g.fillStyle = badgeGrad;
  g.beginPath();
  g.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#08222a';
  g.font = font(24, 'bold');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(d.level), badgeCx, badgeCy + 1);
  g.font = font(11, 'bold');
  g.fillText('LVL', badgeCx, badgeCy - badgeR - 10);

  // ---- xp bar ----
  const barX = nameX;
  const barY = pad + 84;
  const barW = W - pad - badgeR * 2 - 40 - nameX;
  g.fillStyle = PALETTE.textMuted;
  g.font = font(13, 'regular');
  g.textAlign = 'left';
  g.fillText(`Опыт  ${fmtInt(d.xp)} / ${fmtInt(d.xpNext)}`, barX, barY - 6);
  drawProgressBar(g, barX, barY, barW, 12, d.xpNext > 0 ? d.xp / d.xpNext : 1, PALETTE.xp);

  // ---- stat row: energy / coins / pearls ----
  const statsY = pad + 130;
  const statW = (W - pad * 2 - 24) / 3;
  const statH = 78;
  const statData: { icon: (cx: number, cy: number) => void; label: string; value: string; bar?: number; barColor?: string }[] = [
    {
      icon: (cx, cy) => drawEnergyIcon(g, cx, cy, 26),
      label: 'Энергия',
      value: `${fmtInt(d.energy)} / ${fmtInt(d.maxEnergy)}`,
      bar: d.maxEnergy > 0 ? d.energy / d.maxEnergy : 0,
      barColor: PALETTE.energy,
    },
    { icon: (cx, cy) => drawCoinIcon(g, cx, cy, 18), label: 'Монеты', value: fmtInt(d.coins) },
    { icon: (cx, cy) => drawPearlIcon(g, cx, cy, 16), label: 'Жемчуг', value: fmtInt(d.pearls) },
  ];
  statData.forEach((s, i) => {
    const x = pad + i * (statW + 12);
    drawPanel(g, x, statsY, statW, statH, 14);
    s.icon(x + 32, statsY + 30);
    g.fillStyle = PALETTE.textSecondary;
    g.font = font(13, 'regular');
    g.textAlign = 'left';
    g.fillText(s.label, x + 58, statsY + 24);
    g.fillStyle = PALETTE.textPrimary;
    g.font = font(20, 'bold');
    g.fillText(s.value, x + 58, statsY + 48);
    if (s.bar !== undefined) {
      drawProgressBar(g, x + 16, statsY + statH - 14, statW - 32, 8, s.bar, s.barColor ?? PALETTE.energy);
    }
  });

  // ---- season pass (optional, slim bar under stats) ----
  let contentTop = statsY + statH + 22;
  if (d.seasonPass) {
    const spY = contentTop;
    drawPanel(g, pad, spY, W - pad * 2, 46, 14);
    g.fillStyle = PALETTE.textSecondary;
    g.font = font(13, 'regular');
    g.fillText(`Боевой пропуск · уровень ${d.seasonPass.level}/${d.seasonPass.max}`, pad + 16, spY + 19);
    drawProgressBar(g, pad + 16, spY + 26, W - pad * 2 - 32, 10, d.seasonPass.max > 0 ? d.seasonPass.level / d.seasonPass.max : 0, PALETTE.pass);
    contentTop += 46 + 18;
  }

  // ---- lower area: gear (left) + collection/stats (right) ----
  const lowerH = H - contentTop - pad;
  const leftW = Math.round((W - pad * 2 - 20) * 0.52);
  const rightW = W - pad * 2 - 20 - leftW;
  const rightX = pad + leftW + 20;

  drawPanel(g, pad, contentTop, leftW, lowerH, 16);
  g.fillStyle = PALETTE.textPrimary;
  g.font = font(16, 'bold');
  g.textAlign = 'left';
  g.fillText('Снаряжение', pad + 18, contentTop + 28);

  const gearRows = d.gear.slice(0, 4);
  // Reserve a small bottom safety margin (headerH + margin) so the last row's text descenders never
  // touch the panel's rounded bottom edge, regardless of row count.
  const gearHeaderH = 44;
  const gearBottomMargin = 10;
  const rowH = Math.min(52, (lowerH - gearHeaderH - gearBottomMargin) / Math.max(1, gearRows.length));
  const slotNames: Record<string, string> = { rod: 'Удочка', reel: 'Катушка', line: 'Леска', outfit: 'Костюм' };
  gearRows.forEach((item, i) => {
    const ry = contentTop + gearHeaderH + i * rowH;
    const rowCenter = ry + rowH / 2;
    const color = rarityColor(item.tier);
    g.fillStyle = color;
    roundRect(g, pad + 18, ry + 4, 6, rowH - 10, 3);

    // slot caption (small, above)
    g.fillStyle = PALETTE.textSecondary;
    g.font = font(11, 'regular');
    g.textAlign = 'left';
    g.fillText(slotNames[item.slot] ?? item.slot, pad + 34, rowCenter - 8);

    // item name + rarity label share the same baseline below the caption
    const nameBaseline = rowCenter + 13;
    g.fillStyle = PALETTE.textPrimary;
    g.font = font(15, 'bold');
    g.textAlign = 'left';
    const nameText = truncateToWidth(g, `${item.name}${item.upgrade > 0 ? ` +${item.upgrade}` : ''}`, leftW - 130);
    g.fillText(nameText, pad + 34, nameBaseline);

    g.fillStyle = color;
    g.font = font(12, 'bold');
    g.textAlign = 'right';
    g.fillText(RARITY_INFO[item.tier].name, pad + leftW - 18, nameBaseline);
    g.textAlign = 'left';
  });
  if (gearRows.length === 0) {
    g.fillStyle = PALETTE.textMuted;
    g.font = font(14, 'regular');
    g.fillText('Нет снаряжения', pad + 18, contentTop + 66);
  }

  drawPanel(g, rightX, contentTop, rightW, lowerH, 16);
  g.fillStyle = PALETTE.textPrimary;
  g.font = font(16, 'bold');
  g.fillText('Коллекция', rightX + 18, contentTop + 28);
  g.font = font(22, 'bold');
  g.fillStyle = PALETTE.xp;
  g.fillText(`${d.collection.caught} / ${d.collection.total}`, rightX + 18, contentTop + 56);
  drawProgressBar(g, rightX + 18, contentTop + 66, rightW - 36, 8, d.collection.total > 0 ? d.collection.caught / d.collection.total : 0, PALETTE.xp);

  const statsList = d.stats.slice(0, 4);
  const statsTop = contentTop + 92;
  const statsRowH = Math.min(32, (lowerH - 100) / Math.max(1, statsList.length));
  statsList.forEach((s, i) => {
    const sy = statsTop + i * statsRowH;
    g.fillStyle = PALETTE.textSecondary;
    g.font = font(13, 'regular');
    g.textAlign = 'left';
    g.fillText(truncateToWidth(g, s.label, rightW - 100), rightX + 18, sy + 14);
    g.fillStyle = PALETTE.textPrimary;
    g.font = font(14, 'bold');
    g.textAlign = 'right';
    g.fillText(s.value, rightX + rightW - 18, sy + 14);
    g.textAlign = 'left';
  });

  watermark(g, W, H);
  return canvas.encode('png');
}
