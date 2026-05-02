/**
 * Canvas-drawn overlays for RADAR verdicts.
 * - Stamp mark: 8×8 coloured shape on the radar desk tile
 * - Verdict badge: 6×6 icon above agent's head
 * - T2 sparkle: small diamond indicator for LLM-assessed verdicts
 */

import {
  RADAR_DENY_COLOR,
  RADAR_HOLD_COLOR,
  RADAR_PROCEED_COLOR,
  RADAR_T2_SPARKLE_COLOR,
  RADAR_VERDICT_FADE_SEC,
} from '../../constants.js';

type Verdict = 'PROCEED' | 'HOLD' | 'DENY';

function verdictColor(verdict: Verdict): string {
  switch (verdict) {
    case 'PROCEED':
      return RADAR_PROCEED_COLOR;
    case 'HOLD':
      return RADAR_HOLD_COLOR;
    case 'DENY':
      return RADAR_DENY_COLOR;
  }
}

function verdictAlpha(timer: number): number {
  if (timer > RADAR_VERDICT_FADE_SEC) return 1;
  if (timer <= 0) return 0;
  return timer / RADAR_VERDICT_FADE_SEC;
}

/** Draw the verdict shape (circle, pause bars, or X) at a given center point and size. */
function drawVerdictShape(
  ctx: CanvasRenderingContext2D,
  verdict: Verdict,
  cx: number,
  cy: number,
  size: number,
  zoom: number,
): void {
  switch (verdict) {
    case 'PROCEED': {
      // Green circle
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'HOLD': {
      // Amber pause bars
      const barW = size * 0.25;
      const barH = size * 0.7;
      const gap = size * 0.15;
      ctx.fillRect(cx - gap - barW, cy - barH / 2, barW, barH);
      ctx.fillRect(cx + gap, cy - barH / 2, barW, barH);
      break;
    }
    case 'DENY': {
      // Red X
      const half = size * 0.35;
      ctx.lineWidth = Math.max(1, zoom);
      ctx.beginPath();
      ctx.moveTo(cx - half, cy - half);
      ctx.lineTo(cx + half, cy + half);
      ctx.moveTo(cx + half, cy - half);
      ctx.lineTo(cx - half, cy + half);
      ctx.stroke();
      break;
    }
  }
}

/** Draw a small 4×4 sparkle diamond — indicates T2 (LLM) assessment. */
function drawT2Sparkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  zoom: number,
  alpha: number,
): void {
  const s = 2 * zoom; // half-size of diamond
  ctx.save();
  ctx.globalAlpha = alpha * 0.9;
  ctx.fillStyle = RADAR_T2_SPARKLE_COLOR;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s); // top
  ctx.lineTo(cx + s, cy); // right
  ctx.lineTo(cx, cy + s); // bottom
  ctx.lineTo(cx - s, cy); // left
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draw a 16×16 stamp mark on the desk — full-tile sized for visibility. */
export function drawStampMark(
  ctx: CanvasRenderingContext2D,
  verdict: Verdict,
  timer: number,
  deskPixelX: number,
  deskPixelY: number,
  zoom: number,
  isT2: boolean,
): void {
  const alpha = verdictAlpha(timer);
  if (alpha <= 0) return;

  ctx.save();
  const color = verdictColor(verdict);
  const size = 14 * zoom;
  const cx = deskPixelX;
  const cy = deskPixelY;

  // White outline for contrast against the desk
  ctx.globalAlpha = alpha;
  ctx.fillStyle = RADAR_T2_SPARKLE_COLOR; // white
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + zoom, 0, Math.PI * 2);
  ctx.fill();

  // Coloured shape
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  drawVerdictShape(ctx, verdict, cx, cy, size, zoom);

  if (isT2) {
    drawT2Sparkle(ctx, cx + size * 0.5, cy - size * 0.5, zoom, alpha);
  }

  ctx.restore();
}

/** Draw a 14×14 verdict badge above an agent's head. */
export function drawVerdictBadge(
  ctx: CanvasRenderingContext2D,
  verdict: Verdict,
  timer: number,
  charPixelX: number,
  charPixelY: number,
  zoom: number,
  isT2: boolean,
): void {
  const alpha = verdictAlpha(timer);
  if (alpha <= 0) return;

  ctx.save();
  const color = verdictColor(verdict);
  const size = 14 * zoom;
  const cx = charPixelX;
  const cy = charPixelY - 6 * zoom;

  // White outline circle for contrast
  ctx.globalAlpha = alpha;
  ctx.fillStyle = RADAR_T2_SPARKLE_COLOR;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + zoom, 0, Math.PI * 2);
  ctx.fill();

  // Coloured shape
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  drawVerdictShape(ctx, verdict, cx, cy, size, zoom);

  if (isT2) {
    drawT2Sparkle(ctx, cx + size * 0.45, cy - size * 0.45, zoom, alpha);
  }

  ctx.restore();
}
