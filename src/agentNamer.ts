import { spawn } from 'child_process';
import * as path from 'path';
import type * as vscode from 'vscode';

import {
  NAMER_BULLET_CHAR_LIMIT,
  NAMER_CLAUDE_TIMEOUT_MS,
  NAMER_RECENT_MESSAGES_FOR_PROMPT,
  NAMER_THROTTLE_MS,
  NAMER_TOOL_HISTOGRAM_WINDOW,
  NAMER_TRANSITION_HISTOGRAM_DELTA,
} from './constants.js';
import type { AgentState } from './types.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const BASH_TOOLS = new Set(['Bash']);
const TASK_TOOLS = new Set(['Task', 'Agent']);

/** Extract the skill name from an `activeSkillToolId` record's status string. */
function activeSkillName(agent: AgentState): string | null {
  const toolId = agent.activeSkillToolId;
  if (!toolId) return null;
  const status = agent.activeToolStatuses.get(toolId);
  if (!status) return null;
  // Status format: "Skill: superpowers:brainstorming" or "Skill: graphify"
  const match = status.match(/^Skill:\s+(.+)$/);
  if (!match) return null;
  const full = match[1].trim();
  // Strip plugin prefix (e.g. "superpowers:brainstorming" → "brainstorming")
  const colonIdx = full.indexOf(':');
  return colonIdx >= 0 ? full.slice(colonIdx + 1) : full;
}

/** Derive a lowercase, kebab-friendly workspace label from the projectDir. */
function workspaceLabel(agent: AgentState): string {
  const projectDir = agent.projectDir;
  if (/\.claude(\/|$)/.test(projectDir) || /\/\.claude$/.test(projectDir)) {
    return 'claude';
  }
  const base = agent.folderName ?? path.basename(projectDir);
  return base
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Context word: skill overrides workspace when present. */
function contextWord(agent: AgentState): string {
  const skill = activeSkillName(agent);
  if (skill) return skill;
  return workspaceLabel(agent);
}

/** Tool window = last N entries of recentTools (newest-last). */
function toolWindow(agent: AgentState): string[] {
  const tools = agent.recentTools ?? [];
  if (tools.length <= NAMER_TOOL_HISTOGRAM_WINDOW) return tools;
  return tools.slice(tools.length - NAMER_TOOL_HISTOGRAM_WINDOW);
}

/**
 * Count the tools in the histogram window and return the dominant role, or null.
 * Precedence:
 *   1. Task count ≥ 2 → 'orquestrador'
 *   2. Write+Edit+NotebookEdit > 50% → 'escritor'
 *   3. Read+Grep+Glob+WebFetch+WebSearch > 50% → 'pesquisador'
 *   4. Bash > 50% → 'operador'
 *   5. else null
 */
function roleFromWindow(tools: string[]): string | null {
  if (tools.length === 0) return null;

  const taskCount = tools.filter((t) => TASK_TOOLS.has(t)).length;
  if (taskCount >= 2) return 'orquestrador';

  const writeCount = tools.filter((t) => WRITE_TOOLS.has(t)).length;
  const readCount = tools.filter((t) => READ_TOOLS.has(t)).length;
  const bashCount = tools.filter((t) => BASH_TOOLS.has(t)).length;
  const total = tools.length;

  if (writeCount / total > 0.5) return 'escritor';
  if (readCount / total > 0.5) return 'pesquisador';
  if (bashCount / total > 0.5) return 'operador';
  return null;
}

/** Produces a 1-3 word pt-BR lowercase task label. Returns "" if no signals at all. */
export function computeHeuristicLabel(agent: AgentState): string {
  const ctx = contextWord(agent);
  const role = roleFromWindow(toolWindow(agent));
  if (ctx && role) return `${ctx} ${role}`;
  if (ctx) return ctx;
  if (role) return role;
  return '';
}

/**
 * Recompute the task label and notify the webview only if it changed.
 * Mutates `agent.taskLabel` as a side effect.
 */
export function maybeSendTaskLabel(agent: AgentState, webview?: vscode.Webview): void {
  const next = computeHeuristicLabel(agent);
  if (!next) return;
  if (next === agent.taskLabel) return;
  agent.taskLabel = next;
  webview?.postMessage({
    type: 'agentLabelUpdated',
    id: agent.id,
    label: next,
    source: 'heuristic',
  });
}

/**
 * Record a tool invocation in the agent's sliding histogram window.
 * Mutates agent.recentTools. Drops the oldest entry when over capacity.
 */
export function recordToolUse(agent: AgentState, toolName: string): void {
  if (!agent.recentTools) agent.recentTools = [];
  agent.recentTools.push(toolName);
  if (agent.recentTools.length > NAMER_TOOL_HISTOGRAM_WINDOW) {
    agent.recentTools.splice(0, agent.recentTools.length - NAMER_TOOL_HISTOGRAM_WINDOW);
  }
}

const NAME_REGEX = /^[a-z0-9à-ÿ\- ]{1,40}$/;

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
  return trimmed;
}

/** Build a fresh signals snapshot from the current agent state. */
function currentSignals(agent: AgentState): NonNullable<AgentState['nameSignals']> {
  const tools = toolWindow(agent);
  const histogram: Record<string, number> = {};
  for (const t of tools) histogram[t] = (histogram[t] ?? 0) + 1;
  return {
    cwdBase: workspaceLabel(agent),
    lastSkill: activeSkillName(agent),
    toolHistogram: histogram,
    messageCountAtLastRefine: agent.messageCount ?? 0,
    heuristicRole: roleFromWindow(tools),
  };
}

/**
 * Decide whether the agent deserves a fresh LLM refinement now.
 *   - Respects the throttle (NAMER_THROTTLE_MS since lastLlmRefineAt)
 *   - Returns true on first-ever call (no prior snapshot)
 *   - Returns true when skill, role, or histogram delta has shifted significantly
 */
export function detectTransition(agent: AgentState, now: number): boolean {
  const last = agent.lastLlmRefineAt ?? 0;
  if (last > 0 && now - last < NAMER_THROTTLE_MS) return false;

  const prior = agent.nameSignals;
  if (!prior) return true;

  const curr = currentSignals(agent);

  if (curr.lastSkill !== prior.lastSkill) return true;
  if (curr.heuristicRole !== prior.heuristicRole) return true;

  // Histogram delta: sum of |curr - prior| divided by total current.
  let delta = 0;
  let total = 0;
  const keys = new Set([...Object.keys(curr.toolHistogram), ...Object.keys(prior.toolHistogram)]);
  for (const k of keys) {
    const c = curr.toolHistogram[k] ?? 0;
    const p = prior.toolHistogram[k] ?? 0;
    delta += Math.abs(c - p);
    total += c;
  }
  if (total === 0) return false;
  return delta / total > NAMER_TRANSITION_HISTOGRAM_DELTA;
}

/** Build the pt-BR prompt sent to `claude -p`. */
export function buildRefinePrompt(args: {
  cwd: string;
  heuristic: string;
  recentBullets: string[];
  toolHistogram: Record<string, number>;
  skill: string | null;
}): string {
  const toolSummary =
    Object.entries(args.toolHistogram)
      .sort((a, b) => b[1] - a[1])
      .map(([t, c]) => `${t}×${c}`)
      .join(', ') || 'nenhuma';

  const bullets =
    args.recentBullets.length > 0
      ? args.recentBullets.map((b) => `- ${b.slice(0, NAMER_BULLET_CHAR_LIMIT)}`).join('\n')
      : '- (nenhuma atividade registrada)';

  return `Você está nomeando um agente de IA de programação com base no que ele está fazendo agora.

WORKSPACE: ${args.cwd}
NOME HEURÍSTICO (fallback): ${args.heuristic}
ATIVIDADE RECENTE (últimas ${NAMER_RECENT_MESSAGES_FOR_PROMPT} mensagens usuário+assistente, resumidas):
${bullets}
TOOLS RECENTES: ${toolSummary}
SKILL ATIVA: ${args.skill ?? 'nenhuma'}

Produza um nome curto em pt-BR com 1-3 palavras em minúsculas, sem prefixo "agente", sem pontuação. Formato: [contexto] [papel], ou só [contexto], ou só [papel]. Prefira palavras concretas do domínio sobre genéricas (ex: "obsidian" em vez de "vault", "marketing" em vez de "conteudo"). Use "escritor" / "pesquisador" / "orquestrador" / "operador" para papéis. Se estiver em dúvida, retorne o nome heurístico literalmente.

Responda APENAS com o nome, nada mais.`;
}

/** Spawn `claude -p` and return its stdout (validated+trimmed) or null on failure. */
export function refineViaClaude(prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let settled = false;
    const done = (result: string | null): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawn('claude', ['-p', prompt, '--output-format', 'text'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: NAMER_CLAUDE_TIMEOUT_MS,
      });
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.on('error', () => done(null));
      child.on('close', (code) => {
        if (code !== 0) {
          done(null);
          return;
        }
        done(parseRefinedName(stdout));
      });
    } catch {
      done(null);
    }
  });
}
