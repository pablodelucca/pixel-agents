/** Ordered status prefixes mapped back to tool names for animation selection. */
export const STATUS_TO_TOOL: Array<[string, string]> = [
  ['Searching the web', 'WebSearch'],
  ['Searching web', 'WebSearch'],
  ['Searching files', 'Glob'],
  ['Searching code', 'Grep'],
  ['Reading terminal output', 'Read'],
  ['Writing terminal input', 'Write'],
  ['Applying patch', 'Edit'],
  ['Listing directory', 'Glob'],
  ['Waiting for your answer', 'AskUserQuestion'],
  ['Waiting on subtask', 'Task'],
  ['Subtask:', 'Task'],
  ['Editing notebook', 'NotebookEdit'],
  ['Planning', 'NotebookEdit'],
  ['Reading', 'Read'],
  ['Writing', 'Write'],
  ['Editing', 'Edit'],
  ['Fetching', 'WebFetch'],
  ['Running', 'Bash'],
  ['Searching', 'Grep'],
  ['Task', 'Task'],
];

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of STATUS_TO_TOOL) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN } from '../constants.js';

/** Compute a default integer zoom level (device pixels per sprite pixel) */
export function defaultZoom(): number {
  const dpr =
    typeof globalThis === 'object' && 'devicePixelRatio' in globalThis
      ? Number((globalThis as { devicePixelRatio?: number }).devicePixelRatio) || 1
      : 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}
