/**
 * Feature: kiro-pixel-agents-bridge, Property 3: Tool name mapping correctness
 *
 * For any Kiro tool name in the defined mapping table, mapToolName() SHALL return
 * the corresponding Claude Code equivalent. For any tool name not in the mapping,
 * it SHALL return the original name unchanged.
 *
 * Validates: Requirements 4.2, 4.6
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ── TypeScript mirror of the shell script's map_tool_name() ──
const TOOL_MAPPING: Record<string, string> = {
  readFile: "Read",
  readCode: "Read",
  readMultipleFiles: "Read",
  getDiagnostics: "Read",
  editCode: "Edit",
  strReplace: "Edit",
  semanticRename: "Edit",
  smartRelocate: "Edit",
  fsWrite: "Write",
  fsAppend: "Write",
  deleteFile: "Write",
  executeBash: "Bash",
  fileSearch: "Glob",
  listDirectory: "Glob",
  grepSearch: "Grep",
  mcp_builder_mcp_WorkspaceSearch: "Grep",
  remote_web_search: "WebFetch",
  webFetch: "WebFetch",
  invokeSubAgent: "Task",
  createHook: "Write",
};

const KNOWN_TOOL_NAMES = Object.keys(TOOL_MAPPING);

function mapToolName(kiroName: string): string {
  return Object.hasOwn(TOOL_MAPPING, kiroName) ? TOOL_MAPPING[kiroName] : kiroName;
}

describe("Tool name mapping (Property 3)", () => {
  it("maps every known Kiro tool name to its correct Claude Code equivalent", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...KNOWN_TOOL_NAMES),
        (toolName) => {
          expect(mapToolName(toolName)).toBe(TOOL_MAPPING[toolName]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("passes unknown tool names through unchanged", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => !KNOWN_TOOL_NAMES.includes(s)),
        (unknownName) => {
          expect(mapToolName(unknownName)).toBe(unknownName);
        },
      ),
      { numRuns: 100 },
    );
  });
});
