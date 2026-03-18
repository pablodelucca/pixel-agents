import { STATUS_TO_TOOL, ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN } from '../constants.js';

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of STATUS_TO_TOOL) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

/** Compute a default integer zoom level (device pixels per sprite pixel) */
export function defaultZoom(): number {
  const dpr =
    typeof globalThis === 'object' && 'devicePixelRatio' in globalThis
      ? Number((globalThis as { devicePixelRatio?: number }).devicePixelRatio) || 1
      : 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}
