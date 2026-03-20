import {
  AGENT_VIS_COLOR_ACTIVE,
  AGENT_VIS_COLOR_DONE,
  AGENT_VIS_COLOR_HEURISTIC,
  AGENT_VIS_COLOR_PENDING,
} from './constants.js';
import type { ToolActivity } from './office/types.js';

export function formatToolDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function mergeToolActivityLists(
  active: ToolActivity[],
  history: ToolActivity[],
): ToolActivity[] {
  const activeIds = new Set(active.map((tool) => tool.toolId));
  return [...history.filter((tool) => !activeIds.has(tool.toolId)), ...active];
}

export function getToolActivityColor(tool: ToolActivity): string {
  if (tool.permissionState === 'pending') return AGENT_VIS_COLOR_PENDING;
  if (tool.source === 'heuristic') return AGENT_VIS_COLOR_HEURISTIC;
  return tool.done ? AGENT_VIS_COLOR_DONE : AGENT_VIS_COLOR_ACTIVE;
}
