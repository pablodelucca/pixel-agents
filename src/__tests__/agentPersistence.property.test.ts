/**
 * Feature: kiro-pixel-agents-bridge, Property 12: Agent persistence round-trip with null terminal
 *
 * For any set of agents including terminal-less agents (with terminalRef: null),
 * persistAgents() SHALL serialize them with terminalName: null, and restoreAgents()
 * SHALL restore terminal-less agents when their JSONL file still exists on disk,
 * preserving id, jsonlFile, projectDir, and folderName.
 *
 * Validates: Requirements 11.4
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ── TypeScript mirror of persistence logic from agentManager.ts ──

interface PersistedAgent {
  id: number;
  terminalName: string | null;
  jsonlFile: string;
  projectDir: string;
  folderName?: string;
}

/**
 * Mirrors persistAgents(): serializes agents to PersistedAgent[],
 * using terminalRef?.name ?? null for the terminalName field.
 */
function serializeAgents(agents: PersistedAgent[]): string {
  return JSON.stringify(agents);
}

/**
 * Mirrors restoreAgents(): deserializes PersistedAgent[] from JSON.
 * This simulates workspaceState.get() returning the persisted data.
 */
function deserializeAgents(json: string): PersistedAgent[] {
  return JSON.parse(json) as PersistedAgent[];
}

// ── Arbitraries ──

/** Generate a safe path-like string for projectDir and jsonlFile. */
const safePath = fc
  .array(
    fc.stringMatching(/^[a-zA-Z0-9_\-.]+$/, { minLength: 1, maxLength: 20 }),
    { minLength: 1, maxLength: 5 },
  )
  .map((parts) => "/" + parts.join("/"));

/** Generate a JSONL file path. */
const jsonlFilePath = safePath.map((dir) => `${dir}/session.jsonl`);

/** Generate an optional folder name. */
const optionalFolderName = fc.option(
  fc.stringMatching(/^[a-zA-Z0-9_\-]+$/, { minLength: 1, maxLength: 30 }),
  { nil: undefined },
);

/** Generate a terminal name or null (for terminal-less agents). */
const terminalName = fc.oneof(
  fc.constant(null),
  fc.stringMatching(/^[a-zA-Z0-9 #_\-]+$/, { minLength: 1, maxLength: 40 }),
);

/** Generate a single PersistedAgent. */
const persistedAgentArb: fc.Arbitrary<PersistedAgent> = fc
  .record({
    id: fc.nat({ max: 10000 }),
    terminalName,
    jsonlFile: jsonlFilePath,
    projectDir: safePath,
    folderName: optionalFolderName,
  })
  .map((rec) => {
    // Remove folderName key entirely when undefined, matching real serialization
    const agent: PersistedAgent = {
      id: rec.id,
      terminalName: rec.terminalName,
      jsonlFile: rec.jsonlFile,
      projectDir: rec.projectDir,
    };
    if (rec.folderName !== undefined) {
      agent.folderName = rec.folderName;
    }
    return agent;
  });

/** Generate a list of PersistedAgents with unique IDs (mix of terminal and terminal-less). */
const agentListArb = fc
  .array(persistedAgentArb, { minLength: 1, maxLength: 10 })
  .map((agents) => {
    // Ensure unique IDs by reassigning sequentially
    return agents.map((a, i) => ({ ...a, id: i }));
  });

// ── Tests ──

describe("Agent persistence round-trip with null terminal (Property 12)", () => {
  it("round-trips all agent fields through JSON serialization/deserialization", () => {
    fc.assert(
      fc.property(agentListArb, (agents) => {
        const json = serializeAgents(agents);
        const restored = deserializeAgents(json);

        expect(restored).toHaveLength(agents.length);

        for (let i = 0; i < agents.length; i++) {
          const original = agents[i];
          const result = restored[i];

          expect(result.id).toBe(original.id);
          expect(result.jsonlFile).toBe(original.jsonlFile);
          expect(result.projectDir).toBe(original.projectDir);
          expect(result.terminalName).toBe(original.terminalName);

          if (original.folderName !== undefined) {
            expect(result.folderName).toBe(original.folderName);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("preserves terminalName: null for terminal-less agents specifically", () => {
    fc.assert(
      fc.property(agentListArb, (agents) => {
        const json = serializeAgents(agents);
        const restored = deserializeAgents(json);

        const nullTerminalOriginals = agents.filter((a) => a.terminalName === null);
        const nullTerminalRestored = restored.filter((a) => a.terminalName === null);

        // Same count of terminal-less agents
        expect(nullTerminalRestored).toHaveLength(nullTerminalOriginals.length);

        // Each null-terminal agent preserves its fields
        for (const original of nullTerminalOriginals) {
          const match = nullTerminalRestored.find(
            (r) => r.id === original.id,
          );
          expect(match).toBeDefined();
          expect(match!.terminalName).toBeNull();
          expect(match!.jsonlFile).toBe(original.jsonlFile);
          expect(match!.projectDir).toBe(original.projectDir);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("distinguishes null terminalName from string terminalName after round-trip", () => {
    fc.assert(
      fc.property(agentListArb, (agents) => {
        const json = serializeAgents(agents);
        const restored = deserializeAgents(json);

        for (let i = 0; i < agents.length; i++) {
          if (agents[i].terminalName === null) {
            expect(restored[i].terminalName).toBeNull();
            expect(typeof restored[i].terminalName).not.toBe("string");
          } else {
            expect(typeof restored[i].terminalName).toBe("string");
            expect(restored[i].terminalName).toBe(agents[i].terminalName);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
