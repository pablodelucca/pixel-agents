/**
 * Feature: kiro-pixel-agents-bridge, Property 11: Terminal-less agent processing equivalence
 *
 * For any JSONL record, processTranscriptLine() SHALL produce identical state transitions
 * on an AgentState with terminalRef: null as it would on an AgentState with a valid
 * terminalRef — the parser does not branch on terminal presence.
 *
 * Validates: Requirements 11.2, 11.3
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

// Mock vscode module before importing anything that depends on it
vi.mock("vscode", () => ({}), { virtual: true });

import { processTranscriptLine } from "../transcriptParser.js";
import type { AgentState } from "../types.js";

// ── Helpers ──

/** Create a fresh AgentState with the given terminal ref. */
function makeAgent(
  id: number,
  terminalRef: { name: string } | null,
): AgentState {
  return {
    id,
    terminalRef: terminalRef as AgentState["terminalRef"],
    projectDir: "/test/project",
    jsonlFile: "/test/project/session.jsonl",
    fileOffset: 0,
    lineBuffer: "",
    activeToolIds: new Set<string>(),
    activeToolStatuses: new Map<string, string>(),
    activeToolNames: new Map<string, string>(),
    activeSubagentToolIds: new Map<string, Set<string>>(),
    activeSubagentToolNames: new Map<string, Map<string, string>>(),
    isWaiting: false,
    permissionSent: false,
    hadToolsInTurn: false,
  };
}

/** Extract the comparable state fields from an AgentState. */
function extractState(agent: AgentState) {
  return {
    activeToolIds: [...agent.activeToolIds].sort(),
    activeToolStatuses: Object.fromEntries(agent.activeToolStatuses),
    activeToolNames: Object.fromEntries(agent.activeToolNames),
    isWaiting: agent.isWaiting,
    permissionSent: agent.permissionSent,
    hadToolsInTurn: agent.hadToolsInTurn,
  };
}

// ── JSONL Record Arbitraries ──

const toolIdArb = fc
  .stringMatching(/^[0-9a-f]{24}$/)
  .map((hex) => `toolu_kiro_${hex}`);

const toolNameArb = fc.constantFrom(
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "Task",
);

/** User prompt record — triggers new turn. */
const userPromptRecordArb = fc.constant(
  JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: "[Kiro prompt]",
    },
    timestamp: new Date().toISOString(),
  }),
);

/** Assistant tool_use record. */
const toolUseRecordArb = fc
  .record({
    toolId: toolIdArb,
    toolName: toolNameArb,
  })
  .map(({ toolId, toolName }) =>
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolId,
            name: toolName,
            input: {},
          },
        ],
      },
      timestamp: new Date().toISOString(),
    }),
  );

/** User tool_result record — needs a matching tool_use_id. */
function toolResultRecordArb(toolId: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolId,
        },
      ],
    },
    timestamp: new Date().toISOString(),
  });
}

/** System turn_duration record. */
const turnDurationRecordArb = fc.constant(
  JSON.stringify({
    type: "system",
    subtype: "turn_duration",
    timestamp: new Date().toISOString(),
  }),
);

/**
 * Generate a coherent sequence of JSONL records:
 * user prompt → (tool_use → tool_result)* → turn_duration
 */
const jsonlSequenceArb = fc
  .array(
    fc.record({ toolId: toolIdArb, toolName: toolNameArb }),
    { minLength: 0, maxLength: 5 },
  )
  .map((tools) => {
    const records: string[] = [];
    // Start with a user prompt
    records.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "[Kiro prompt]" },
        timestamp: new Date().toISOString(),
      }),
    );
    // Add tool_use / tool_result pairs
    for (const { toolId, toolName } of tools) {
      records.push(
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: toolId, name: toolName, input: {} }],
          },
          timestamp: new Date().toISOString(),
        }),
      );
      records.push(toolResultRecordArb(toolId));
    }
    // End with turn_duration
    records.push(
      JSON.stringify({
        type: "system",
        subtype: "turn_duration",
        timestamp: new Date().toISOString(),
      }),
    );
    return records;
  });

// ── Tests ──

describe("Terminal-less agent processing equivalence (Property 11)", () => {
  let waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  let permissionTimers: Map<number, ReturnType<typeof setTimeout>>;

  beforeEach(() => {
    vi.useFakeTimers();
    waitingTimers = new Map();
    permissionTimers = new Map();
  });

  it("produces identical state for terminal-backed and terminal-less agents on coherent sequences", () => {
    fc.assert(
      fc.property(jsonlSequenceArb, (records) => {
        // Create two agents: one with a mock terminal, one without
        const agentWithTerminal = makeAgent(1, { name: "Claude Code (1)" });
        const agentWithoutTerminal = makeAgent(2, null);

        const agentsMap = new Map<number, AgentState>();
        agentsMap.set(1, agentWithTerminal);
        agentsMap.set(2, agentWithoutTerminal);

        const wt = new Map<number, ReturnType<typeof setTimeout>>();
        const pt = new Map<number, ReturnType<typeof setTimeout>>();

        // Process the same records through both agents
        for (const line of records) {
          processTranscriptLine(1, line, agentsMap, wt, pt, undefined);
          processTranscriptLine(2, line, agentsMap, wt, pt, undefined);
        }

        // Assert identical state transitions
        const stateA = extractState(agentWithTerminal);
        const stateB = extractState(agentWithoutTerminal);

        expect(stateB.activeToolIds).toEqual(stateA.activeToolIds);
        expect(stateB.activeToolStatuses).toEqual(stateA.activeToolStatuses);
        expect(stateB.activeToolNames).toEqual(stateA.activeToolNames);
        expect(stateB.isWaiting).toBe(stateA.isWaiting);
        expect(stateB.permissionSent).toBe(stateA.permissionSent);
        expect(stateB.hadToolsInTurn).toBe(stateA.hadToolsInTurn);
      }),
      { numRuns: 100 },
    );
  });

  it("produces identical state for individual record types", () => {
    const singleRecordArb = fc.oneof(
      userPromptRecordArb,
      toolUseRecordArb,
      turnDurationRecordArb,
    );

    fc.assert(
      fc.property(singleRecordArb, (record) => {
        const agentWithTerminal = makeAgent(1, { name: "Claude Code (1)" });
        const agentWithoutTerminal = makeAgent(2, null);

        const agentsMap = new Map<number, AgentState>();
        agentsMap.set(1, agentWithTerminal);
        agentsMap.set(2, agentWithoutTerminal);

        const wt = new Map<number, ReturnType<typeof setTimeout>>();
        const pt = new Map<number, ReturnType<typeof setTimeout>>();

        processTranscriptLine(1, record, agentsMap, wt, pt, undefined);
        processTranscriptLine(2, record, agentsMap, wt, pt, undefined);

        const stateA = extractState(agentWithTerminal);
        const stateB = extractState(agentWithoutTerminal);

        expect(stateB).toEqual(stateA);
      }),
      { numRuns: 100 },
    );
  });
});
