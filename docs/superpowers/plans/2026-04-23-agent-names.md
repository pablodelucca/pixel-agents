# Agent Names — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing heuristic agent-name feature ("Phase 1") with: smarter role detection (`orquestrador`), skill-based context, sliding tool histogram, transition detection, and LLM refinement via `claude -p` subprocess.

**Architecture:** Phase 1 already implemented `src/agentNamer.ts` (heuristic), message `agentLabelUpdated`, `AgentState.taskLabel`, webview rendering via `ToolOverlay.tsx`. Phase 2 extends the same module — new functions `detectTransition()`, `refineViaClaude()`, `parseRefinedName()`, `maybeRefineTaskLabel()` — and adds LLM refinement triggered initially and on detected transitions, throttled and budgeted.

**Tech Stack:** TypeScript (extension backend, strict), Node `child_process.spawn`, Vitest (server-side tests), React + Canvas webview.

**Starting Point (Phase 1 already implemented):**

- `src/agentNamer.ts` — `computeHeuristicLabel()`, `maybeSendTaskLabel()`
- `AgentState.taskLabel?: string` — the current label
- Message type: `agentLabelUpdated { id, label }`
- `Character.taskLabel?: string` (webview) — set from message
- `ToolOverlay.tsx` renders label with opacity 0.6 / 1.0
- `maybeSendTaskLabel(agent, webview)` called from `transcriptParser.ts`, `fileWatcher.ts`, `agentManager.ts`

**Spec:** `docs/superpowers/specs/2026-04-23-agent-names-design.md`

---

## File Structure

### Modified

- `src/constants.ts` — add `NAMER_*` constants
- `src/types.ts` — extend `AgentState` with Phase 2 fields
- `src/agentNamer.ts` — upgrade heuristic + add LLM refinement functions + orchestrator
- `src/transcriptParser.ts` — feed sliding window, call refinement orchestrator
- `server/tsconfig.test.json` — include `../src/agentNamer.ts`
- `webview-ui/src/office/components/ToolOverlay.tsx` — adjust fade opacity (0.6 → 0.4)

### Created

- `server/__tests__/agentNamer.test.ts` — unit tests for pure functions

---

## Task 1: Add Phase 2 constants

**Files:**

- Modify: `src/constants.ts`

- [ ] **Step 1: Append namer constants**

Add at the end of `src/constants.ts`:

```ts
// ── Agent Name Refinement (Phase 2) ─────────────────────────
export const NAMER_INITIAL_REFINE_DELAY_MS = 60_000;
export const NAMER_INITIAL_REFINE_MSG_THRESHOLD = 5;
export const NAMER_THROTTLE_MS = 90_000;
export const NAMER_MAX_REFINES_PER_SESSION = 20;
export const NAMER_CLAUDE_TIMEOUT_MS = 30_000;
export const NAMER_TOOL_HISTOGRAM_WINDOW = 30;
export const NAMER_TRANSITION_HISTOGRAM_DELTA = 0.3;
export const NAMER_RECENT_MESSAGES_FOR_PROMPT = 15;
export const NAMER_BULLET_CHAR_LIMIT = 200;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run check-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat(namer): add Phase 2 constants for name refinement"
```

---

## Task 2: Extend AgentState with Phase 2 fields

**Files:**

- Modify: `src/types.ts`

- [ ] **Step 1: Add fields after `taskLabel`**

Current `src/types.ts` has (line 65-66):

```ts
  /** Heuristic pt-BR task label shown floating above the character (e.g. "pixel-agents escritor"). */
  taskLabel?: string;
```

Replace those two lines with:

```ts
  /** Heuristic pt-BR task label shown floating above the character (e.g. "pixel-agents escritor"). */
  taskLabel?: string;

  // -- Name refinement (Phase 2) --
  /** Sliding window of the most recent tool names used (cap NAMER_TOOL_HISTOGRAM_WINDOW). */
  recentTools?: string[];
  /** Snapshot of the signals at the last refinement attempt — used by detectTransition(). */
  nameSignals?: {
    cwdBase: string;
    lastSkill: string | null;
    toolHistogram: Record<string, number>;
    messageCountAtLastRefine: number;
    heuristicRole: string | null;
  };
  /** Total user+assistant messages seen for this agent (bumps on every new record from processTranscriptLine). */
  messageCount?: number;
  /** Timestamp (ms) of the last LLM refinement attempt. 0 = never. */
  lastLlmRefineAt?: number;
  /** Count of LLM refinements made for this agent session. */
  llmRefineCount?: number;
  /** When true, LLM refinement is disabled for the rest of this agent's session (after a subprocess failure). */
  llmRefineDisabled?: boolean;
  /** When true, an LLM subprocess call is currently in flight for this agent. */
  llmRefineInFlight?: boolean;
  /** Timestamp (ms) when the agent was first created — used by initial-refine window. */
  createdAt?: number;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run check-types`
Expected: no errors (all new fields are optional).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(namer): extend AgentState with Phase 2 refinement fields"
```

---

## Task 3: Set up test infrastructure for agentNamer

**Files:**

- Modify: `server/tsconfig.test.json`
- Create: `server/__tests__/agentNamer.test.ts`

- [ ] **Step 1: Include agentNamer in server test config**

Current `server/tsconfig.test.json` `include` array (lines 7-13):

```json
  "include": [
    "__tests__/**/*.ts",
    "src/**/*.ts",
    "../src/types.ts",
    "../src/timerManager.ts",
    "../src/transcriptParser.ts"
  ]
```

Add `"../src/agentNamer.ts"` and `"../src/constants.ts"` to the array:

```json
  "include": [
    "__tests__/**/*.ts",
    "src/**/*.ts",
    "../src/types.ts",
    "../src/timerManager.ts",
    "../src/transcriptParser.ts",
    "../src/agentNamer.ts",
    "../src/constants.ts"
  ]
```

- [ ] **Step 2: Create skeleton test file**

Create `server/__tests__/agentNamer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { AgentState } from '../../src/types.js';

function createAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    id: 1,
    sessionId: 'sess-1',
    isExternal: false,
    projectDir: '/Users/pimai/Documents/pixel-agents',
    jsonlFile: '/tmp/sess-1.jsonl',
    fileOffset: 0,
    lineBuffer: '',
    activeToolIds: new Set(),
    activeToolStatuses: new Map(),
    activeToolNames: new Map(),
    activeSubagentToolIds: new Map(),
    activeSubagentToolNames: new Map(),
    backgroundAgentToolIds: new Set(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
    lastDataAt: 0,
    linesProcessed: 0,
    seenUnknownRecordTypes: new Set(),
    hookDelivered: false,
    inputTokens: 0,
    outputTokens: 0,
    recentTools: [],
    messageCount: 0,
    llmRefineCount: 0,
    lastLlmRefineAt: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('agentNamer', () => {
  it('placeholder — to be replaced by real tests', () => {
    expect(createAgent().id).toBe(1);
  });
});
```

- [ ] **Step 3: Run the placeholder test to confirm the test infra works**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: `1 passed (1)`.

- [ ] **Step 4: Commit**

```bash
git add server/tsconfig.test.json server/__tests__/agentNamer.test.ts
git commit -m "test(namer): set up Phase 2 test infrastructure"
```

---

## Task 4: Implement `parseRefinedName` (TDD)

**Files:**

- Modify: `server/__tests__/agentNamer.test.ts`
- Modify: `src/agentNamer.ts`

- [ ] **Step 1: Write failing tests**

Replace the placeholder test block in `server/__tests__/agentNamer.test.ts` with this additional block (keep the imports and `createAgent` helper):

```ts
import { parseRefinedName } from '../../src/agentNamer.js';

describe('parseRefinedName', () => {
  it('accepts 1 lowercase word', () => {
    expect(parseRefinedName('orquestrador')).toBe('orquestrador');
  });

  it('accepts 2 lowercase words', () => {
    expect(parseRefinedName('obsidian escritor')).toBe('obsidian escritor');
  });

  it('accepts 3 lowercase words', () => {
    expect(parseRefinedName('pixel-agents orquestrador marketing')).toBe(
      'pixel-agents orquestrador marketing',
    );
  });

  it('trims surrounding whitespace and trailing newline', () => {
    expect(parseRefinedName('  obsidian escritor \n')).toBe('obsidian escritor');
  });

  it('accepts accented chars', () => {
    expect(parseRefinedName('pesquisa avançada')).toBe('pesquisa avançada');
  });

  it('rejects uppercase', () => {
    expect(parseRefinedName('Obsidian Escritor')).toBeNull();
  });

  it('rejects punctuation', () => {
    expect(parseRefinedName('obsidian, escritor')).toBeNull();
  });

  it('rejects more than 3 words', () => {
    expect(parseRefinedName('a b c d')).toBeNull();
  });

  it('rejects empty and whitespace-only', () => {
    expect(parseRefinedName('')).toBeNull();
    expect(parseRefinedName('   ')).toBeNull();
  });

  it('rejects strings longer than 30 chars', () => {
    expect(parseRefinedName('a'.repeat(31))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: tests fail with `Cannot find export 'parseRefinedName'` or similar import error.

- [ ] **Step 3: Implement `parseRefinedName`**

Append to `src/agentNamer.ts`:

```ts
const NAME_REGEX = /^[a-z0-9à-ÿ\- ]{1,30}$/;

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: `11 passed (11)`.

- [ ] **Step 5: Commit**

```bash
git add server/__tests__/agentNamer.test.ts src/agentNamer.ts
git commit -m "feat(namer): add parseRefinedName with validation"
```

---

## Task 5: Upgrade heuristic — orquestrador, sliding window, skill context (TDD)

**Files:**

- Modify: `server/__tests__/agentNamer.test.ts`
- Modify: `src/agentNamer.ts`

**Rationale:** Current `computeHeuristicLabel` uses `activeToolNames` (live), has no `orquestrador`, no skill detection, uses `explorando` as fallback. Spec calls for sliding window, `orquestrador` for `Task ≥ 2`, skill-as-context, and no role if none dominant.

- [ ] **Step 1: Write failing tests**

Append to `server/__tests__/agentNamer.test.ts`:

```ts
import { computeHeuristicLabel } from '../../src/agentNamer.js';

describe('computeHeuristicLabel (Phase 2 upgrade)', () => {
  it('returns just workspace when no tools used yet', () => {
    const agent = createAgent({ recentTools: [] });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents');
  });

  it('returns "[workspace] escritor" when Write+Edit dominate', () => {
    const agent = createAgent({
      recentTools: ['Write', 'Edit', 'Write', 'Edit', 'Read'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents escritor');
  });

  it('returns "[workspace] pesquisador" when Read+Grep dominate', () => {
    const agent = createAgent({
      recentTools: ['Read', 'Grep', 'Glob', 'Read', 'Write'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents pesquisador');
  });

  it('returns "[workspace] orquestrador" when Task count >= 2 (beats other dominants)', () => {
    const agent = createAgent({
      recentTools: ['Task', 'Task', 'Read', 'Read', 'Read'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents orquestrador');
  });

  it('returns "[workspace] operador" when Bash dominates (>50%)', () => {
    const agent = createAgent({
      recentTools: ['Bash', 'Bash', 'Bash', 'Read'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents operador');
  });

  it('omits role when no category dominates', () => {
    const agent = createAgent({
      recentTools: ['Read', 'Write', 'Bash', 'Read', 'Write', 'Bash'],
    });
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents');
  });

  it('uses skill name as context when an active skill exists', () => {
    const agent = createAgent({
      projectDir: '/Users/x/repo',
      recentTools: ['Write', 'Edit'],
      activeSkillToolId: 'skill-abc',
      activeToolStatuses: new Map([['skill-abc', 'Skill: superpowers:brainstorming']]),
    });
    expect(computeHeuristicLabel(agent)).toBe('brainstorming escritor');
  });

  it('strips plugin prefix from skill context (superpowers:brainstorming → brainstorming)', () => {
    const agent = createAgent({
      activeSkillToolId: 'skill-abc',
      activeToolStatuses: new Map([['skill-abc', 'Skill: superpowers:brainstorming']]),
      recentTools: [],
    });
    expect(computeHeuristicLabel(agent)).toBe('brainstorming');
  });

  it('lowercases PascalCase workspace names', () => {
    const agent = createAgent({ projectDir: '/Users/x/PiMindIA', recentTools: [] });
    expect(computeHeuristicLabel(agent)).toBe('pimindia');
  });

  it('returns "claude" for workspaces containing .claude', () => {
    const agent = createAgent({ projectDir: '/Users/x/.claude', recentTools: [] });
    expect(computeHeuristicLabel(agent)).toBe('claude');
  });

  it('only considers the most recent NAMER_TOOL_HISTOGRAM_WINDOW entries', () => {
    // 40 tools total: 10 Write/Edit (old), then 30 Read/Grep (newest 30)
    const old = Array<string>(10).fill('Write');
    const recent = Array<string>(30).fill('Read');
    const agent = createAgent({ recentTools: [...old, ...recent] });
    // Only the last 30 are used — all Read — so pesquisador dominates.
    expect(computeHeuristicLabel(agent)).toBe('pixel-agents pesquisador');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: many failures in the new describe block (current implementation differs).

- [ ] **Step 3: Replace the heuristic implementation**

Replace the entire body of `src/agentNamer.ts` (keep imports) with:

```ts
import * as path from 'path';
import type * as vscode from 'vscode';

import { NAMER_TOOL_HISTOGRAM_WINDOW } from './constants.js';
import type { AgentState } from './types.js';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
const BASH_TOOLS = new Set(['Bash']);
const TASK_TOOLS = new Set(['Task', 'Agent']);

const NAME_REGEX = /^[a-z0-9à-ÿ\- ]{1,30}$/;

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
 *   2. Write+Edit+NotebookEdit ≥ 50% → 'escritor'
 *   3. Read+Grep+Glob+WebFetch+WebSearch ≥ 50% → 'pesquisador'
 *   4. Bash ≥ 50% → 'operador'
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: all tests pass including the new `Phase 2 upgrade` block.

- [ ] **Step 5: Run full test suite to check nothing else broke**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agentNamer.ts server/__tests__/agentNamer.test.ts
git commit -m "feat(namer): upgrade heuristic with orquestrador, sliding window, skill context"
```

---

## Task 6: Feed the sliding window from transcriptParser

**Files:**

- Modify: `src/agentNamer.ts`
- Modify: `src/transcriptParser.ts`
- Modify: `server/__tests__/agentNamer.test.ts`

- [ ] **Step 1: Write failing test for `recordToolUse`**

Append to `server/__tests__/agentNamer.test.ts`:

```ts
import { recordToolUse } from '../../src/agentNamer.js';

describe('recordToolUse', () => {
  it('initializes recentTools if absent', () => {
    const agent = createAgent({ recentTools: undefined });
    recordToolUse(agent, 'Read');
    expect(agent.recentTools).toEqual(['Read']);
  });

  it('appends in order', () => {
    const agent = createAgent({ recentTools: [] });
    recordToolUse(agent, 'Read');
    recordToolUse(agent, 'Write');
    expect(agent.recentTools).toEqual(['Read', 'Write']);
  });

  it('caps the window at NAMER_TOOL_HISTOGRAM_WINDOW', () => {
    const agent = createAgent({ recentTools: [] });
    for (let i = 0; i < 40; i++) {
      recordToolUse(agent, `Tool${i}`);
    }
    expect(agent.recentTools?.length).toBe(30);
    expect(agent.recentTools?.[0]).toBe('Tool10'); // oldest kept
    expect(agent.recentTools?.[29]).toBe('Tool39'); // newest
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: `Cannot find export 'recordToolUse'`.

- [ ] **Step 3: Implement `recordToolUse`**

Append to `src/agentNamer.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Call `recordToolUse` from transcriptParser**

In `src/transcriptParser.ts`, update the import line (currently line 13):

```ts
import { maybeSendTaskLabel } from './agentNamer.js';
```

to:

```ts
import { maybeSendTaskLabel, recordToolUse } from './agentNamer.js';
```

Then locate the existing call to `maybeSendTaskLabel(agent, webview);` near line 297 (inside the loop that processes `tool_use` blocks). Immediately **before** that line, add the record call:

```ts
recordToolUse(agent, toolName);
maybeSendTaskLabel(agent, webview);
```

- [ ] **Step 6: Verify typecheck and full test suite**

Run: `npm run check-types && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/agentNamer.ts src/transcriptParser.ts server/__tests__/agentNamer.test.ts
git commit -m "feat(namer): add sliding window tool histogram via recordToolUse"
```

---

## Task 7: Implement `detectTransition` (TDD)

**Files:**

- Modify: `src/agentNamer.ts`
- Modify: `server/__tests__/agentNamer.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `server/__tests__/agentNamer.test.ts`:

```ts
import { detectTransition } from '../../src/agentNamer.js';

describe('detectTransition', () => {
  const baseSignals = {
    cwdBase: 'pixel-agents',
    lastSkill: null,
    toolHistogram: { Read: 5, Write: 5 },
    messageCountAtLastRefine: 0,
    heuristicRole: 'escritor' as string | null,
  };

  it('returns true when no prior snapshot exists (first call)', () => {
    const agent = createAgent({ nameSignals: undefined, lastLlmRefineAt: 0 });
    expect(detectTransition(agent, 100_000)).toBe(true);
  });

  it('returns false when no signal changed', () => {
    const agent = createAgent({
      nameSignals: { ...baseSignals },
      lastLlmRefineAt: 0,
      recentTools: ['Read', 'Read', 'Read', 'Read', 'Read'],
      messageCount: 0,
    });
    // Same role pesquisador (current) vs escritor (prior) — actually this IS a change.
    // Let's match: compute current signals same as prior.
    agent.nameSignals = {
      ...baseSignals,
      heuristicRole: 'pesquisador',
      toolHistogram: { Read: 5 },
    };
    expect(detectTransition(agent, 200_000)).toBe(false);
  });

  it('returns true when the active skill changed', () => {
    const agent = createAgent({
      nameSignals: { ...baseSignals, lastSkill: null },
      activeSkillToolId: 'skill-1',
      activeToolStatuses: new Map([['skill-1', 'Skill: graphify']]),
      recentTools: [],
      messageCount: 0,
      lastLlmRefineAt: 0,
    });
    expect(detectTransition(agent, 200_000)).toBe(true);
  });

  it('returns true when heuristic role changed', () => {
    const agent = createAgent({
      nameSignals: { ...baseSignals, heuristicRole: 'escritor' },
      recentTools: ['Read', 'Read', 'Read', 'Read', 'Read'],
      messageCount: 0,
      lastLlmRefineAt: 0,
    });
    expect(detectTransition(agent, 200_000)).toBe(true);
  });

  it('returns false within throttle window (< 90s since last refine)', () => {
    const agent = createAgent({
      nameSignals: { ...baseSignals, heuristicRole: 'escritor' },
      recentTools: ['Read', 'Read', 'Read', 'Read', 'Read'], // pesquisador now
      lastLlmRefineAt: 150_000,
      messageCount: 0,
    });
    // now = lastLlmRefineAt + 60s < 90s throttle
    expect(detectTransition(agent, 150_000 + 60_000)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: `Cannot find export 'detectTransition'`.

- [ ] **Step 3: Implement `detectTransition`**

Append to `src/agentNamer.ts`:

```ts
import { NAMER_THROTTLE_MS } from './constants.js';

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
  return delta / total > 0.3; // NAMER_TRANSITION_HISTOGRAM_DELTA — imported in final version
}
```

**Note:** the literal `0.3` above is intentional to keep the task self-contained; in Task 9 we replace it with the constant import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agentNamer.ts server/__tests__/agentNamer.test.ts
git commit -m "feat(namer): add detectTransition for LLM refine triggers"
```

---

## Task 8: Implement `refineViaClaude` subprocess wrapper

**Files:**

- Modify: `src/agentNamer.ts`

**Rationale:** Not TDD — subprocess calls to `claude -p` are flaky/dependent on auth. We test `parseRefinedName` (already done) and the orchestrator glue at integration level via manual verification. This wrapper is thin and we keep it small.

- [ ] **Step 1: Add imports and implementation**

In `src/agentNamer.ts`, update the imports at the top:

```ts
import * as path from 'path';
import { spawn } from 'child_process';
import type * as vscode from 'vscode';
```

Append to the end of `src/agentNamer.ts`:

```ts
import {
  NAMER_CLAUDE_TIMEOUT_MS,
  NAMER_RECENT_MESSAGES_FOR_PROMPT,
  NAMER_BULLET_CHAR_LIMIT,
} from './constants.js';

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
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run check-types`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/agentNamer.ts
git commit -m "feat(namer): add refineViaClaude subprocess wrapper"
```

---

## Task 9: Implement orchestrator `maybeRefineTaskLabel`

**Files:**

- Modify: `src/agentNamer.ts`

**Rationale:** Wires heuristic + transition + subprocess. Applies throttle, budget, concurrency, initial-refine delay. Also fixes the `0.3` literal from Task 7 to use the constant.

- [ ] **Step 1: Implement the orchestrator and initial-refine eligibility**

Append to `src/agentNamer.ts`:

```ts
import {
  NAMER_INITIAL_REFINE_DELAY_MS,
  NAMER_INITIAL_REFINE_MSG_THRESHOLD,
  NAMER_MAX_REFINES_PER_SESSION,
  NAMER_TRANSITION_HISTOGRAM_DELTA,
} from './constants.js';

/**
 * Called after each tool_use or user prompt. Attempts LLM refinement if gates pass.
 * - Ignores sub-agents (id < 0).
 * - Skips when LLM is disabled for this session or a refine is in flight.
 * - Requires initial eligibility (age ≥ NAMER_INITIAL_REFINE_DELAY_MS OR messageCount ≥ threshold) AND a detected transition.
 * - Respects budget (max refines/session) and throttle.
 * - On success, sets `agent.taskLabel` and posts `agentLabelUpdated` with `source: 'llm'`.
 */
export async function maybeRefineTaskLabel(
  agent: AgentState,
  webview: vscode.Webview | undefined,
  readRecentBullets: (agent: AgentState) => Promise<string[]>,
  now: number = Date.now(),
): Promise<void> {
  if (agent.id < 0) return;
  if (agent.llmRefineDisabled) return;
  if (agent.llmRefineInFlight) return;
  if ((agent.llmRefineCount ?? 0) >= NAMER_MAX_REFINES_PER_SESSION) return;

  // Initial-refine eligibility: the agent must be old enough OR have enough messages.
  const age = now - (agent.createdAt ?? now);
  const msgs = agent.messageCount ?? 0;
  const eligible =
    age >= NAMER_INITIAL_REFINE_DELAY_MS || msgs >= NAMER_INITIAL_REFINE_MSG_THRESHOLD;
  if (!eligible) return;

  if (!detectTransition(agent, now)) return;

  agent.llmRefineInFlight = true;
  try {
    const heuristic = computeHeuristicLabel(agent);
    if (!heuristic) return; // nothing to base refinement on yet

    const tools = toolWindow(agent);
    const histogram: Record<string, number> = {};
    for (const t of tools) histogram[t] = (histogram[t] ?? 0) + 1;

    const bullets = await readRecentBullets(agent).catch(() => []);
    const prompt = buildRefinePrompt({
      cwd: agent.projectDir,
      heuristic,
      recentBullets: bullets,
      toolHistogram: histogram,
      skill: activeSkillName(agent),
    });

    const refined = await refineViaClaude(prompt);
    agent.lastLlmRefineAt = now;
    agent.llmRefineCount = (agent.llmRefineCount ?? 0) + 1;
    agent.nameSignals = currentSignals(agent);

    if (refined === null) {
      // Subprocess failed OR returned invalid output.
      // We disable only on subprocess error; parse-invalid is silent.
      // However we can't distinguish here — conservative: disable after 3 consecutive nulls.
      // Simple approach for v1: a single failure flips llmRefineDisabled = true.
      agent.llmRefineDisabled = true;
      return;
    }

    if (refined !== agent.taskLabel) {
      agent.taskLabel = refined;
      webview?.postMessage({
        type: 'agentLabelUpdated',
        id: agent.id,
        label: refined,
        source: 'llm',
      });
    }
  } finally {
    agent.llmRefineInFlight = false;
  }
}
```

- [ ] **Step 2: Replace the literal 0.3 in detectTransition**

In `src/agentNamer.ts`, find:

```ts
return delta / total > 0.3; // NAMER_TRANSITION_HISTOGRAM_DELTA — imported in final version
```

Replace with:

```ts
return delta / total > NAMER_TRANSITION_HISTOGRAM_DELTA;
```

- [ ] **Step 3: Verify typecheck and tests still pass**

Run: `npm run check-types && cd server && npx vitest run __tests__/agentNamer.test.ts`
Expected: typecheck clean, all agentNamer tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/agentNamer.ts
git commit -m "feat(namer): add maybeRefineTaskLabel orchestrator"
```

---

## Task 10: Wire refinement into transcriptParser

**Files:**

- Modify: `src/transcriptParser.ts`

- [ ] **Step 1: Import the orchestrator and add a helper to read recent bullets**

Update the import in `src/transcriptParser.ts` (currently line 13):

```ts
import { maybeSendTaskLabel, recordToolUse } from './agentNamer.js';
```

to:

```ts
import { maybeRefineTaskLabel, maybeSendTaskLabel, recordToolUse } from './agentNamer.js';
```

Also add these imports near the top:

```ts
import * as fs from 'fs';
import { NAMER_RECENT_MESSAGES_FOR_PROMPT } from './constants.js';
```

(If `fs` is already imported, skip the duplicate.)

- [ ] **Step 2: Add a helper function at module level**

Near the top of `src/transcriptParser.ts` (just below the imports and above `const PERMISSION_EXEMPT_TOOLS`), add:

```ts
/** Read the last N assistant/user text bullets from the agent's JSONL, best-effort. */
async function readRecentBullets(agent: AgentState): Promise<string[]> {
  try {
    const data = await fs.promises.readFile(agent.jsonlFile, 'utf8');
    const lines = data.split('\n').filter((l) => l.trim());
    const bullets: string[] = [];
    for (
      let i = lines.length - 1;
      i >= 0 && bullets.length < NAMER_RECENT_MESSAGES_FOR_PROMPT;
      i--
    ) {
      try {
        const rec = JSON.parse(lines[i]);
        if (rec.type === 'user' && typeof rec.message?.content === 'string') {
          bullets.push(`user: ${rec.message.content}`);
        } else if (rec.type === 'assistant' && Array.isArray(rec.message?.content)) {
          for (const b of rec.message.content) {
            if (b.type === 'text' && typeof b.text === 'string') {
              bullets.push(`assistant: ${b.text}`);
              break;
            }
          }
        }
      } catch {
        // skip malformed lines
      }
    }
    return bullets.reverse();
  } catch {
    return [];
  }
}
```

- [ ] **Step 3: Call `maybeRefineTaskLabel` after `maybeSendTaskLabel` in the tool_use path**

Locate the tool_use block near line 297 where you added `recordToolUse` + `maybeSendTaskLabel` in Task 6. After those two lines, add a fire-and-forget call:

```ts
recordToolUse(agent, toolName);
maybeSendTaskLabel(agent, webview);
void maybeRefineTaskLabel(agent, webview, readRecentBullets);
```

- [ ] **Step 4: Also trigger refinement on new user prompts**

Find the section in `processTranscriptLine` that handles `record.type === 'user'` with string content (look for the comment `New user text prompt — new turn starting` — around line 380). Right after `agent.hadToolsInTurn = false;`, add:

```ts
agent.messageCount = (agent.messageCount ?? 0) + 1;
maybeSendTaskLabel(agent, webview);
void maybeRefineTaskLabel(agent, webview, readRecentBullets);
```

- [ ] **Step 5: Verify typecheck and full test suite**

Run: `npm run check-types && npm test`
Expected: all pass. Note: no new tests — refinement orchestrator is exercised via manual verification (Task 12).

- [ ] **Step 6: Commit**

```bash
git add src/transcriptParser.ts
git commit -m "feat(namer): trigger LLM refinement from transcriptParser"
```

---

## Task 11: Initialize `createdAt` and `messageCount` when an agent is created

**Files:**

- Modify: `src/agentManager.ts` or wherever `AgentState` is constructed.

- [ ] **Step 1: Find the agent creation site**

Run: `grep -n "id:\s*agentId\|sessionId:" src/agentManager.ts | head -20`

Look for the location where new `AgentState` objects are created (likely in a function like `launchAgent`, `adoptAgent`, or `restoreAgent`).

- [ ] **Step 2: Initialize the new fields**

For each site where an `AgentState` literal is created, add these fields to the object:

```ts
  createdAt: Date.now(),
  messageCount: 0,
  recentTools: [],
  llmRefineCount: 0,
  lastLlmRefineAt: 0,
```

(All fields are optional — missing ones default safely in the namer — but initializing them is cleaner and matches TypeScript `exactOptionalPropertyTypes`-style expectations.)

- [ ] **Step 3: Verify typecheck**

Run: `npm run check-types`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/agentManager.ts
git commit -m "feat(namer): initialize Phase 2 fields at agent creation"
```

---

## Task 12: Adjust label fade opacity 0.6 → 0.4

**Files:**

- Modify: `webview-ui/src/office/components/ToolOverlay.tsx`

- [ ] **Step 1: Update the opacity value**

In `webview-ui/src/office/components/ToolOverlay.tsx`, find (around line 133):

```tsx
              opacity: isSelected || isHovered ? 1 : 0.6,
```

Replace with:

```tsx
              opacity: isSelected || isHovered ? 1 : 0.4,
```

- [ ] **Step 2: Verify webview tests and build**

Run: `npm run test:webview && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add webview-ui/src/office/components/ToolOverlay.tsx
git commit -m "feat(namer): strengthen label fade opacity (0.6 → 0.4)"
```

---

## Task 13: Manual verification in Extension Dev Host

**Files:** none — this is runtime verification.

- [ ] **Step 1: Build and launch**

Run: `npm run build`
Then press `F5` in VS Code to launch the Extension Development Host.

- [ ] **Step 2: Create an agent and observe initial label**

- Click "+ Agent" in the Pixel Agents panel.
- Open a Claude terminal in this workspace (`pixel-agents`).
- Expected: a label appears above the character within 1-2s showing `pixel-agents` (just the workspace since no tools used yet).

- [ ] **Step 3: Drive the heuristic**

- In the Claude terminal, ask it to do something write-heavy: "edit 3 files to add a comment".
- Expected: label transitions to `pixel-agents escritor` shortly after the Edit tool calls start.

- [ ] **Step 4: Observe LLM refinement**

- Wait ~60s OR send ≥ 5 prompts, then do something that shifts role (e.g., ask it to grep/read instead of edit).
- Expected: after 2-5 seconds of the transition, the label updates again to something refined by Claude — e.g., could become `pixel-agents pesquisador` still, or something more specific like `agentNamer pesquisador` depending on what Claude sees in the transcript.

- [ ] **Step 5: Observe fade**

- Click another character (or canvas empty area) to deselect the agent.
- Expected: the label fades to ~40% opacity. Re-selecting brings it back to 100%.

- [ ] **Step 6: Verify throttle (sanity check)**

- Trigger a series of quick transitions within 90s.
- Expected: label updates at most once per 90s window (check the VS Code output panel for "[Pixel Agents]" logs; no error about subprocess spam).

- [ ] **Step 7: If everything works, commit any incidental fixes found during verification**

If you had to patch bugs, commit them:

```bash
git add -A
git commit -m "fix(namer): <describe any fix found during verification>"
```

If no fixes needed, skip this step.

---

## Recap

- Tasks 1-2: Constants + AgentState shape
- Task 3: Test infra
- Task 4: `parseRefinedName` (TDD)
- Task 5: Upgraded heuristic with orquestrador/sliding window/skill (TDD)
- Task 6: Sliding-window feeder (TDD)
- Task 7: `detectTransition` (TDD)
- Task 8: `refineViaClaude` subprocess wrapper
- Task 9: `maybeRefineTaskLabel` orchestrator
- Task 10: Wire refinement into transcriptParser
- Task 11: Initialize fields at agent creation
- Task 12: Fade opacity tweak
- Task 13: Manual verification

**Total: 13 tasks, ~70 steps.** Budget: 3-4 hours of focused implementation for an engineer familiar with TypeScript + VS Code extension APIs.

## Known limitations (deferred)

- **`/clear` detection does NOT reset `nameSignals` / `llmRefineCount` / `llmRefineDisabled`.** The spec calls for a soft reset when `/clear` is detected mid-session. Deferred because: (a) the throttle self-heals by time, (b) the 20-refinement budget is generous, (c) `llmRefineDisabled` persisting across `/clear` is actually defensive (if subprocess failed once, don't retry spam). Revisit if user reports label staleness after `/clear`.
