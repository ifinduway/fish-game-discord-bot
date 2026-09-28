// Render API (plan §4.6). WP6: real card implementations behind the same names & signatures WP0 stubbed.
import './fonts.js';
import { renderBlackjackCardImpl } from './blackjack.js';
import { renderBossCardImpl } from './boss.js';
import { renderCatchCardImpl } from './catch.js';
import { renderChestCardImpl } from './chest.js';
import { renderLeaderboardCardImpl } from './leaderboard.js';
import { renderProfileCardImpl } from './profile.js';
import { renderSeasonSummaryCardImpl } from './season.js';
import type {
  RenderBlackjackCard,
  RenderBossCard,
  RenderCatchCard,
  RenderChestCard,
  RenderLeaderboardCard,
  RenderProfileCard,
  RenderSeasonSummaryCard,
} from './types.js';

export * from './types.js';

export const renderProfileCard: RenderProfileCard = renderProfileCardImpl;
export const renderCatchCard: RenderCatchCard = renderCatchCardImpl;
export const renderChestCard: RenderChestCard = renderChestCardImpl;
export const renderLeaderboardCard: RenderLeaderboardCard = renderLeaderboardCardImpl;
export const renderBossCard: RenderBossCard = renderBossCardImpl;
export const renderBlackjackCard: RenderBlackjackCard = renderBlackjackCardImpl;
export const renderSeasonSummaryCard: RenderSeasonSummaryCard = renderSeasonSummaryCardImpl;
