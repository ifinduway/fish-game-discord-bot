// Blackjack card (§4.6 renderBlackjackCard). 900×520, green felt table.
import { createCanvas } from '@napi-rs/canvas';
import type { BlackjackCardData } from './types.js';
import { drawCardBack, drawPlayingCard, drawTitle, font, PALETTE, roundRect, roundRectPath, truncateToWidth, watermark } from './common.js';

const W = 900;
const H = 520;
const CARD_W = 96;
const CARD_H = 134;

const RESULT_LABEL: Record<NonNullable<BlackjackCardData['result']>, string> = {
  win: 'Выигрыш!',
  blackjack: 'Блэкджек!',
  lose: 'Поражение',
  push: 'Ничья',
  bust: 'Перебор',
};

const RESULT_COLOR: Record<NonNullable<BlackjackCardData['result']>, string> = {
  win: '#4caf50',
  blackjack: '#f2c14e',
  lose: '#e74c3c',
  push: '#9e9e9e',
  bust: '#e74c3c',
};

export async function renderBlackjackCardImpl(d: BlackjackCardData): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const g = canvas.getContext('2d');

  // green felt background
  const felt = g.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, W * 0.75);
  felt.addColorStop(0, '#0f5c2e');
  felt.addColorStop(1, '#082e18');
  g.save();
  roundRectPath(g, 0, 0, W, H, 24);
  g.clip();
  g.fillStyle = felt;
  g.fillRect(0, 0, W, H);
  // felt arc line (table edge motif)
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(W / 2, H + 120, 420, Math.PI, 0);
  g.stroke();
  g.restore();
  g.strokeStyle = PALETTE.panelBorder;
  g.lineWidth = 2;
  roundRectPath(g, 1, 1, W - 2, H - 2, 24);
  g.stroke();

  const pad = 32;

  // dealer row (top)
  drawTitle(g, 'Дилер', pad, 56, 20, 'rgba(255,255,255,0.85)');
  const dealerCardsY = 68;
  const dealerHidden = !!d.hideDealerHole;
  layoutCards(d.dealer.cards.length).forEach((x, i) => {
    if (dealerHidden && i === 1) {
      drawCardBack(g, pad + x, dealerCardsY, CARD_W, CARD_H);
    } else {
      const c = d.dealer.cards[i]!;
      drawPlayingCard(g, pad + x, dealerCardsY, CARD_W, CARD_H, c.rank, c.suit);
    }
  });
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = font(18, 'bold');
  g.textAlign = 'left';
  g.fillText(dealerHidden ? 'Счёт: ?' : `Счёт: ${d.dealer.total}`, pad, dealerCardsY + CARD_H + 30);

  // center divider with result banner
  const midY = H / 2 + 6;
  if (d.result) {
    const label = RESULT_LABEL[d.result];
    const color = RESULT_COLOR[d.result];
    g.font = font(28, 'bold');
    const tw = g.measureText(label).width + 48;
    const bx = W / 2 - tw / 2;
    g.save();
    g.shadowColor = color;
    g.shadowBlur = 20;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(g, bx, midY - 28, tw, 56, 28);
    g.restore();
    g.strokeStyle = color;
    g.lineWidth = 2;
    roundRectPath(g, bx + 1, midY - 27, tw - 2, 54, 28);
    g.stroke();
    g.fillStyle = color;
    g.textAlign = 'center';
    g.fillText(label, W / 2, midY + 10);
    g.textAlign = 'left';
  }

  // player row (bottom)
  const playerCardsY = H - CARD_H - 84;
  layoutCards(d.player.cards.length).forEach((x, i) => {
    const c = d.player.cards[i]!;
    drawPlayingCard(g, pad + x, playerCardsY, CARD_W, CARD_H, c.rank, c.suit);
  });
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = font(18, 'bold');
  g.fillText(`Счёт: ${d.player.total}`, pad, playerCardsY - 12);
  g.font = font(16, 'regular');
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.textAlign = 'left';
  const who = d.username ? `Игрок: ${d.username}` : 'Игрок';
  g.fillText(truncateToWidth(g, who, 260), pad, H - 20);

  // stake / payout footer (right)
  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = font(16, 'bold');
  g.fillText(`Ставка: ${d.stakeLabel}`, W - pad, H - 40);
  g.fillStyle = d.payout > 0 ? '#7be08a' : 'rgba(255,255,255,0.6)';
  g.fillText(d.payout > 0 ? `Выплата: 🪙 ${d.payout}` : 'Без выплаты', W - pad, H - 20);
  g.textAlign = 'left';

  watermark(g, W, H);
  return canvas.encode('png');
}

/** X offsets (from a common left edge) for `n` overlapping cards. */
function layoutCards(n: number): number[] {
  const overlap = CARD_W * 0.55;
  return Array.from({ length: n }, (_, i) => i * overlap);
}
