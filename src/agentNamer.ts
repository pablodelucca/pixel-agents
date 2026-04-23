import * as path from 'path';
import type * as vscode from 'vscode';

import type { AgentState } from './types.js';

const ROLE_BY_TOOL: Record<string, 'escritor' | 'pesquisador' | 'operador'> = {
  Write: 'escritor',
  Edit: 'escritor',
  NotebookEdit: 'escritor',
  Read: 'pesquisador',
  Grep: 'pesquisador',
  Glob: 'pesquisador',
  WebFetch: 'pesquisador',
  WebSearch: 'pesquisador',
  Bash: 'operador',
  Task: 'operador',
};

function workspaceLabel(agent: AgentState): string {
  const base = agent.folderName ?? path.basename(agent.projectDir).replace(/^-+/, '');
  return base
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-users-pimai-(documents-)?/g, '')
    .replace(/^-+|-+$/g, '');
}

function roleFromTools(agent: AgentState): string | null {
  if (agent.activeSkillToolId) return null;
  const counts: Record<string, number> = {};
  for (const name of agent.activeToolNames.values()) {
    const role = ROLE_BY_TOOL[name];
    if (role) counts[role] = (counts[role] ?? 0) + 1;
  }
  let top: string | null = null;
  let topCount = 0;
  for (const [role, count] of Object.entries(counts)) {
    if (count > topCount) {
      top = role;
      topCount = count;
    }
  }
  return top;
}

/** Produces a 1-3 word pt-BR lowercase task label. */
export function computeHeuristicLabel(agent: AgentState): string {
  const ws = workspaceLabel(agent);
  const role = roleFromTools(agent) ?? 'explorando';
  if (!ws) return role;
  return `${ws} ${role}`.trim().slice(0, 40);
}

/**
 * Recompute the task label and notify the webview only if it changed.
 * Mutates `agent.taskLabel` as a side effect.
 */
export function maybeSendTaskLabel(agent: AgentState, webview?: vscode.Webview): void {
  const next = computeHeuristicLabel(agent);
  if (next === agent.taskLabel) return;
  agent.taskLabel = next;
  webview?.postMessage({ type: 'agentLabelUpdated', id: agent.id, label: next });
}

const NAME_REGEX = /^[a-z0-9à-ÿ -]+$/;

/**
 * Validate and normalize a name returned by the LLM subprocess.
 * Returns the trimmed name if valid, or null if it fails validation.
 */
export function parseRefinedName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!NAME_REGEX.test(trimmed)) return null;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 1 || wordCount > 3) return null;
  // Limit: single words to 30 chars, multi-word phrases to 40 chars
  const maxLength = wordCount === 1 ? 30 : 40;
  if (trimmed.length > maxLength) return null;
  return trimmed;
}
