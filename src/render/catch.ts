// Catch card (§4.6 renderCatchCard). 900×500.
import { createCanvas } from '@napi-rs/canvas';
import type { CatchCardData } from './types.js';
import {
  drawAvatar,
  drawCardBackground,
  drawCoinIcon,
  drawFishIcon,
  drawPanel,
  drawRarityBorder,
  drawTitle,
  fmtInt,
  fmtWeight,
  font,
  PALETTE,
  rarityColor,
  rarityName,
  roundRect,
  stars,
  truncateToWidth,
  watermark,
  withGlow,
} from './common.js';

const W = 900;
const H = 500;

export async function renderCatchCardImpl(d: CatchCardData): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');
  const accent = rarityColor(d.species.rarity);

  drawCardBackground(g, W, H, 24, { colors: [PALETTE.bgDeepNavy, PALETTE.bgTealLight], seed: 11 });
  drawRarityBorder(g, 0, 0, W, H, 24, d.species.rarity, 4);

  const pad = 30;

  // ---- top bar: angler + tags ----
  const avatarR = 26;
  await drawAvatar(g, pad + avatarR, pad + avatarR, avatarR, d.avatarUrl, d.username);
  g.fillStyle = PALETTE.textSecondary;
  g.font = font(15, 'regular');
  g.textAlign = 'left';
  g.fillText(truncateToWidth(g, d.username, 280), pad + avatarR * 2 + 14, pad + avatarR + 5);

  const tags = [d.perfect ? 'Идеальная подсечка!' : null, d.firstOfSpecies ? 'Новый вид!' : null, d.record ? 'Рекорд сервера!' : null, d.seasonal ? 'Сезонная' : null].filter(
    (t): t is string => !!t,
  );
  let tagX = W - pad;
  g.font = font(13, 'bold');
  for (let i = tags.length - 1; i >= 0; i--) {
    const label = tags[i]!;
    const tw = g.measureText(label).width + 22;
    tagX -= tw;
    g.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(g, tagX, pad, tw - 8, 28, 14);
    g.fillStyle = PALETTE.textPrimary;
    g.textAlign = 'center';
    g.fillText(label, tagX + (tw - 8) / 2, pad + 19);
    tagX -= 8;
  }

  // ---- centerpiece: fish icon + name + rarity badge ----
  const centerY = 210;
  withGlow(g, accent, 45, () => {
    drawFishIcon(g, W / 2, centerY, 150, accent);
  });

  g.textAlign = 'center';
  drawTitle(g, d.species.emoji ? `${d.species.emoji} ${d.species.name}` : d.species.name, W / 2, centerY + 110, 34);
  g.textAlign = 'center';

  // rarity badge
  const badgeLabel = rarityName(d.species.rarity).toUpperCase();
  g.font = font(14, 'bold');
  const badgeW = g.measureText(badgeLabel).width + 34;
  const badgeX = W / 2 - badgeW / 2;
  const badgeY = centerY + 122;
  withGlow(g, accent, 18, () => {
    g.fillStyle = accent;
    roundRect(g, badgeX, badgeY, badgeW, 30, 15);
  });
  g.fillStyle = '#0b1620';
  g.fillText(badgeLabel, W / 2, badgeY + 20);
  g.textAlign = 'left';

  // description
  g.fillStyle = PALETTE.textMuted;
  g.font = font(14, 'regular');
  g.textAlign = 'center';
  g.fillText(truncateToWidth(g, d.species.description, W - pad * 2 - 40), W / 2, badgeY + 54);
  g.textAlign = 'left';

  // ---- stat strip ----
  const statsY = H - 108;
  const statW = (W - pad * 2 - 18) / 3;
  const stats: { label: string; value: string; draw?: (x: number, y: number) => void }[] = [
    { label: 'Вес', value: fmtWeight(d.weight) },
    { label: 'Качество', value: `${stars(d.quality)}` },
    { label: 'Стоимость', value: fmtInt(d.value), draw: (x, y) => drawCoinIcon(g, x, y, 13) },
  ];
  stats.forEach((s, i) => {
    const x = pad + i * (statW + 9);
    drawPanel(g, x, statsY, statW, 78, 14);
    g.fillStyle = PALETTE.textSecondary;
    g.font = font(13, 'regular');
    g.textAlign = 'center';
    g.fillText(s.label, x + statW / 2, statsY + 24);
    g.fillStyle = s.label === 'Качество' ? '#f5c542' : PALETTE.textPrimary;
    g.font = font(s.label === 'Качество' ? 22 : 22, 'bold');
    if (s.draw) {
      const tw = g.measureText(s.value).width;
      s.draw(x + statW / 2 - tw / 2 - 16, statsY + 47);
      g.fillText(s.value, x + statW / 2 + 10, statsY + 54);
    } else {
      g.fillText(s.value, x + statW / 2, statsY + 54);
    }
  });
  g.textAlign = 'left';

  // location footer
  g.fillStyle = PALETTE.textMuted;
  g.font = font(13, 'regular');
  g.textAlign = 'left';
  g.fillText(`📍 ${d.location}`, pad, H - 20);

  watermark(g, W, H);
  return canvas.encode('png');
}
