/**
 * Feature: kiro-pixel-agents-bridge, Property 7: JSONL-to-transcript-parser round-trip
 *
 * For any sequence of bridge events (init → tool-start* → tool-done* → agent-stop),
 * the resulting JSONL records, when processed by processTranscriptLine(), SHALL produce
 * the correct agent state transitions: init clears waiting state, tool-start adds to
 * activeToolIds and sets status, tool-done removes from activeToolIds, and agent-stop
 * sets isWaiting: true and clears all active tool state.
 *
 * Validates: Requirements 3.3, 6.3, 10.5
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fc from "fast-check";

// Mock vscode module before importing anything that depends on it
vi.mock("vscode", () => ({}), { virtual: true });

import { processTranscriptLine } from "../transcriptParser.js";
import type { AgentState } from "../types.js";

// ── Helpers ──

const AGENT_ID = 1;

function makeAgent(): AgentState {
  return {
    id: AGENT_ID,
    terminalRef: null,
    projectDir: "/test/project",
    jsonlFile: "/test/project/session.jsonl",
    fileOffset: 0,
    lineBuffer: "",
    activeToolIds: new Set<string>(),
    activeToolStatuses: new Map<string, string>(),
    activeToolNames: new Map<string, string>(),
    activeSubagentToolIds: new Map<string, Set<string>>(),
    activeSubagentToolNames: new Map<string, Map<string, string>>(),
    isWaiting: true, // Start in waiting state to verify init clears it
    permissionSent: false,
    hadToolsInTurn: false,
  };
}

function process(
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
): void {
  processTranscriptLine(AGENT_ID, line, agents, waitingTimers, permissionTimers, undefined);
}

// ── JSONL Record Builders (mirror bridge script output) ──

function buildInitRecord(): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: "[Kiro prompt]" },
    timestamp: new Date().toISOString(),
  });
}

function buildToolStartRecord(toolId: string, toolName: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "tool_use", id: toolId, name: toolName, input: {} }],
    },
    timestamp: new Date().toISOString(),
  });
}

function buildToolDoneRecord(toolId: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolId }],
    },
    timestamp: new Date().toISOString(),
  });
}

function buildAgentStopRecord(): string {
  return JSON.stringify({
    type: "system",
    subtype: "turn_duration",
    timestamp: new Date().toISOString(),
  });
}

// ── Arbitraries ──

const toolIdArb = fc
  .stringMatching(/^[0-9a-f]{24}$/)
  .map((hex) => `toolu_kiro_${hex}`);

const toolNameArb = fc.constantFrom(
  "Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "Task",
);

/** Generate a list of unique tool invocations (id + name pairs). */
const toolInvocationsArb = fc
  .array(
    fc.record({ toolId: toolIdArb, toolName: toolNameArb }),
    { minLength: 0, maxLength: 5 },
  )
  // Ensure unique tool IDs within a sequence
  .map((tools) => {
    const seen = new Set<string>();
    return tools.filter((t) => {
      if (seen.has(t.toolId)) return false;
      seen.add(t.toolId);
      return true;
    });
  });

// ── Tests ──

describe("JSONL-to-transcript-parser round-trip (Property 7)", () => {
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;

  beforeEach(() => {
    vi.useFakeTimers();
    waitingTimers = new Map();
    permissionTimers = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("init (user prompt) clears waiting state", () => {
    fc.assert(
      fc.property(toolInvocationsArb, (_tools) => {
        const agent = makeAgent();
        // Agent starts in waiting state
        expect(agent.isWaiting).toBe(true);

        const agents = new Map<number, AgentState>([[AGENT_ID, agent]]);
        process(buildInitRecord(), agents, waitingTimers, permissionTimers);

        // After init, waiting should be cleared
        expect(agent.isWaiting).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("tool-start adds tool ID to activeToolIds and sets status", () => {
    fc.assert(
      fc.property(toolIdArb, toolNameArb, (toolId, toolName) => {
        const agent = makeAgent();
        const agents = new Map<number, AgentState>([[AGENT_ID, agent]]);

        // Init first to start a turn
        process(buildInitRecord(), agents, waitingTimers, permissionTimers);

        // Tool start
        process(buildToolStartRecord(toolId, toolName), agents, waitingTimers, permissionTimers);

        expect(agent.activeToolIds.has(toolId)).toBe(true);
        expect(agent.activeToolStatuses.has(toolId)).toBe(true);
        expect(agent.activeToolNames.get(toolId)).toBe(toolName);
        expect(agent.isWaiting).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("tool-done removes tool ID from activeToolIds", () => {
    fc.assert(
      fc.property(toolIdArb, toolNameArb, (toolId, toolName) => {
        const agent = makeAgent();
        const agents = new Map<number, AgentState>([[AGENT_ID, agent]]);

        // Init → tool-start → tool-done
        process(buildInitRecord(), agents, waitingTimers, permissionTimers);
        process(buildToolStartRecord(toolId, toolName), agents, waitingTimers, permissionTimers);

        expect(agent.activeToolIds.has(toolId)).toBe(true);

        process(buildToolDoneRecord(toolId), agents, waitingTimers, permissionTimers);

        expect(agent.activeToolIds.has(toolId)).toBe(false);
        expect(agent.activeToolStatuses.has(toolId)).toBe(false);
        expect(agent.activeToolNames.has(toolId)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("agent-stop sets isWaiting true and clears all active tool state", () => {
    fc.assert(
      fc.property(toolInvocationsArb, (tools) => {
        const agent = makeAgent();
        const agents = new Map<number, AgentState>([[AGENT_ID, agent]]);

        // Init
        process(buildInitRecord(), agents, waitingTimers, permissionTimers);

        // Start some tools (don't complete them — agent-stop should clean up)
        for (const { toolId, toolName } of tools) {
          process(buildToolStartRecord(toolId, toolName), agents, waitingTimers, permissionTimers);
        }

        // Agent stop
        process(buildAgentStopRecord(), agents, waitingTimers, permissionTimers);

        expect(agent.isWaiting).toBe(true);
        expect(agent.activeToolIds.size).toBe(0);
        expect(agent.activeToolStatuses.size).toBe(0);
        expect(agent.activeToolNames.size).toBe(0);
        expect(agent.hadToolsInTurn).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("full sequence: init → tool-start* → tool-done* → agent-stop produces correct final state", () => {
    fc.assert(
      fc.property(toolInvocationsArb, (tools) => {
        const agent = makeAgent();
        const agents = new Map<number, AgentState>([[AGENT_ID, agent]]);

        // 1. Init clears waiting
        process(buildInitRecord(), agents, waitingTimers, permissionTimers);
        expect(agent.isWaiting).toBe(false);

        // 2. Tool starts add to activeToolIds
        for (const { toolId, toolName } of tools) {
          process(buildToolStartRecord(toolId, toolName), agents, waitingTimers, permissionTimers);
          expect(agent.activeToolIds.has(toolId)).toBe(true);
        }
        expect(agent.activeToolIds.size).toBe(tools.length);

        // 3. Tool dones remove from activeToolIds
        for (const { toolId } of tools) {
          process(buildToolDoneRecord(toolId), agents, waitingTimers, permissionTimers);
          expect(agent.activeToolIds.has(toolId)).toBe(false);
        }
        expect(agent.activeToolIds.size).toBe(0);

        // 4. Agent stop sets waiting and clears everything
        process(buildAgentStopRecord(), agents, waitingTimers, permissionTimers);
        expect(agent.isWaiting).toBe(true);
        expect(agent.activeToolIds.size).toBe(0);
        expect(agent.activeToolStatuses.size).toBe(0);
        expect(agent.activeToolNames.size).toBe(0);
        expect(agent.permissionSent).toBe(false);
        expect(agent.hadToolsInTurn).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});
