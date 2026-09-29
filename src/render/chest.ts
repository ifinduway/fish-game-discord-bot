// Chest card (§4.6 renderChestCard, amendment §8.6 multi-open). 900×dynamic.
import { createCanvas } from '@napi-rs/canvas';
import type { ChestCardData, ChestRewardView } from './types.js';
import {
  drawCardBackground,
  drawChestIcon,
  drawCoinIcon,
  drawDiamondIcon,
  drawGearIcon,
  drawPanel,
  drawSparkleIcon,
  drawTitle,
  font,
  PALETTE,
  rarityColor,
  rarityName,
  roundRect,
  truncateToWidth,
  watermark,
  withGlow,
} from './common.js';

const W = 900;
const ROW_H = 84;
const HEADER_H = 150;
const FOOTER_H = 56;

const KIND_LABEL: Record<ChestRewardView['kind'], string> = {
  coins: 'Монеты',
  item: 'Предмет',
  gear: 'Снаряжение',
  cosmetic: 'Косметика',
};

export async function renderChestCardImpl(d: ChestCardData): Promise<Buffer> {
  const rewards = d.rewards.slice(0, 5);
  const H = HEADER_H + Math.max(1, rewards.length) * ROW_H + FOOTER_H;
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');

  const topRarity = rewards.reduce<ChestRewardView['rarity']>((best, r) => (rarityOrder(r.rarity) > rarityOrder(best) ? r.rarity : best), 'common');
  const accent = rarityColor(topRarity);

  drawCardBackground(g, W, H, 24, { colors: [PALETTE.bgDeepNavy, '#1a3a2e'], seed: 5 });

  const pad = 32;

  // header: chest icon + title
  withGlow(g, accent, 30, () => {
    drawChestIcon(g, pad + 40, HEADER_H / 2, 68, '#c9973f');
  });
  drawTitle(g, d.chest.name, pad + 92, HEADER_H / 2 - 4, 30);
  g.fillStyle = PALETTE.textSecondary;
  g.font = font(15, 'regular');
  g.fillText(`Открыто наград: ${rewards.length}`, pad + 92, HEADER_H / 2 + 24);

  if (d.pityLeft !== undefined) {
    const label = `До гарантии: ${d.pityLeft}`;
    g.font = font(13, 'bold');
    const tw = g.measureText(label).width + 26;
    const x = W - pad - tw;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(g, x, HEADER_H / 2 - 16, tw, 32, 16);
    g.fillStyle = PALETTE.textPrimary;
    g.textAlign = 'center';
    g.fillText(label, x + tw / 2, HEADER_H / 2 + 5);
    g.textAlign = 'left';
  }

  // reward rows
  rewards.forEach((r, i) => {
    const y = HEADER_H + i * ROW_H + 10;
    const rowH = ROW_H - 14;
    const rowColor = rarityColor(r.rarity);
    drawPanel(g, pad, y, W - pad * 2, rowH, 14);

    // rarity strip
    g.fillStyle = rowColor;
    roundRect(g, pad, y, 6, rowH, 3);

    // icon
    const iconCx = pad + 44;
    const iconCy = y + rowH / 2;
    withGlow(g, rowColor, 16, () => {
      if (r.kind === 'coins') {
        drawCoinIcon(g, iconCx, iconCy, 20);
        return;
      }
      g.fillStyle = rowColor;
      g.beginPath();
      g.arc(iconCx, iconCy, 20, 0, Math.PI * 2);
      g.fill();
      const glyphColor = '#0b1620';
      if (r.kind === 'gear') drawGearIcon(g, iconCx, iconCy, 11, glyphColor);
      else if (r.kind === 'cosmetic') drawSparkleIcon(g, iconCx, iconCy, 12, glyphColor);
      else drawDiamondIcon(g, iconCx, iconCy, 10, glyphColor);
    });

    g.fillStyle = PALETTE.textPrimary;
    g.font = font(19, 'bold');
    g.textAlign = 'left';
    g.fillText(truncateToWidth(g, r.label, W - pad * 2 - 280), pad + 84, y + rowH / 2 - 4);

    g.fillStyle = PALETTE.textSecondary;
    g.font = font(13, 'regular');
    const sub = `${KIND_LABEL[r.kind]}${r.duplicate ? ' · дубликат: монеты' : ''}`;
    g.fillText(sub, pad + 84, y + rowH / 2 + 18);

    g.fillStyle = rowColor;
    g.font = font(13, 'bold');
    g.textAlign = 'right';
    g.fillText(rarityName(r.rarity), W - pad - 20, y + rowH / 2 + 5);
    g.textAlign = 'left';
  });

  if (rewards.length === 0) {
    g.fillStyle = PALETTE.textMuted;
    g.font = font(16, 'regular');
    g.textAlign = 'center';
    g.fillText('Пусто…', W / 2, HEADER_H + ROW_H / 2);
    g.textAlign = 'left';
  }

  watermark(g, W, H);
  return canvas.encode('png');
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
function rarityOrder(r: string): number {
  return RARITY_ORDER.indexOf(r);
}
