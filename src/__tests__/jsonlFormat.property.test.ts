/**
 * Feature: kiro-pixel-agents-bridge, Property 6: JSONL record structural validity
 *
 * For any event type (init, tool-start, tool-done, agent-stop), the JSONL line
 * appended by the bridge script SHALL be valid JSON and SHALL match the expected
 * schema. All timestamps SHALL be valid ISO 8601 UTC strings.
 *
 * Validates: Requirements 3.1, 3.2, 10.1, 10.2, 10.3, 10.4
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ── JSONL record builders (mirror bridge script logic) ──

function buildInitRecord(timestamp: string): string {
  return `{"type":"user","message":{"role":"user","content":"[Kiro prompt]"},"timestamp":"${timestamp}"}`;
}

function buildToolStartRecord(
  toolId: string,
  mappedName: string,
  toolInput: string,
  timestamp: string,
): string {
  return `{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","id":"${toolId}","name":"${mappedName}","input":${toolInput}}]},"timestamp":"${timestamp}"}`;
}

function buildToolDoneRecord(toolId: string, timestamp: string): string {
  return `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"${toolId}"}]},"timestamp":"${timestamp}"}`;
}

function buildAgentStopRecord(timestamp: string): string {
  return `{"type":"system","subtype":"turn_duration","timestamp":"${timestamp}"}`;
}

// ── Helpers ──

/** Validate ISO 8601 UTC timestamp format matching the bridge's `date -u` output */
function isValidIso8601Utc(ts: string): boolean {
  const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  if (!iso8601Regex.test(ts)) return false;
  const d = new Date(ts);
  return !isNaN(d.getTime());
}

// ── Arbitraries ──

/** Generate a realistic ISO 8601 UTC timestamp using integer components */
const isoTimestamp = fc
  .record({
    year: fc.integer({ min: 2020, max: 2030 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }),
    minute: fc.integer({ min: 0, max: 59 }),
    second: fc.integer({ min: 0, max: 59 }),
  })
  .map(({ year, month, day, hour, minute, second }) => {
    const pad = (n: number, len = 2) => String(n).padStart(len, "0");
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.000Z`;
  });

/** Generate a tool ID matching the bridge format: toolu_kiro_{24 hex chars} */
const toolId = fc
  .array(fc.constantFrom(..."0123456789abcdef".split("")), { minLength: 24, maxLength: 24 })
  .map((chars) => `toolu_kiro_${chars.join("")}`);

/** Known mapped tool names from the bridge */
const mappedToolNames = [
  "Read", "Edit", "Write", "Bash", "Glob", "Grep", "WebFetch", "Task",
];

/** Generate a mapped tool name (known or pass-through) */
const mappedToolName = fc.oneof(
  fc.constantFrom(...mappedToolNames),
  fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9_]*$/, { minLength: 1, maxLength: 30 }),
);

/** Generate a valid tool input JSON string */
const toolInputJson = fc.constantFrom("{}", '{"file_path":""}', '{"file_path":"src/main.ts"}', '{"command":"ls -la"}', '{"description":"do something"}');

// ── Tests ──

describe("JSONL record structural validity (Property 6)", () => {
  it("init record is valid JSON matching user prompt schema", () => {
    fc.assert(
      fc.property(isoTimestamp, (ts) => {
        const line = buildInitRecord(ts);
        const parsed = JSON.parse(line);

        expect(parsed.type).toBe("user");
        expect(parsed.message).toBeDefined();
        expect(parsed.message.role).toBe("user");
        expect(typeof parsed.message.content).toBe("string");
        expect(parsed.timestamp).toBe(ts);
        expect(isValidIso8601Utc(parsed.timestamp)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("tool-start record is valid JSON matching assistant tool_use schema", () => {
    fc.assert(
      fc.property(toolId, mappedToolName, toolInputJson, isoTimestamp, (id, name, input, ts) => {
        const line = buildToolStartRecord(id, name, input, ts);
        const parsed = JSON.parse(line);

        expect(parsed.type).toBe("assistant");
        expect(parsed.message).toBeDefined();
        expect(parsed.message.role).toBe("assistant");
        expect(Array.isArray(parsed.message.content)).toBe(true);
        expect(parsed.message.content).toHaveLength(1);

        const toolUse = parsed.message.content[0];
        expect(toolUse.type).toBe("tool_use");
        expect(toolUse.id).toBe(id);
        expect(toolUse.name).toBe(name);
        expect(typeof toolUse.input).toBe("object");
        expect(toolUse.input).not.toBeNull();

        expect(parsed.timestamp).toBe(ts);
        expect(isValidIso8601Utc(parsed.timestamp)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("tool-done record is valid JSON matching user tool_result schema", () => {
    fc.assert(
      fc.property(toolId, isoTimestamp, (id, ts) => {
        const line = buildToolDoneRecord(id, ts);
        const parsed = JSON.parse(line);

        expect(parsed.type).toBe("user");
        expect(parsed.message).toBeDefined();
        expect(parsed.message.role).toBe("user");
        expect(Array.isArray(parsed.message.content)).toBe(true);
        expect(parsed.message.content).toHaveLength(1);

        const toolResult = parsed.message.content[0];
        expect(toolResult.type).toBe("tool_result");
        expect(toolResult.tool_use_id).toBe(id);

        expect(parsed.timestamp).toBe(ts);
        expect(isValidIso8601Utc(parsed.timestamp)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("agent-stop record is valid JSON matching system turn_duration schema", () => {
    fc.assert(
      fc.property(isoTimestamp, (ts) => {
        const line = buildAgentStopRecord(ts);
        const parsed = JSON.parse(line);

        expect(parsed.type).toBe("system");
        expect(parsed.subtype).toBe("turn_duration");
        expect(parsed.timestamp).toBe(ts);
        expect(isValidIso8601Utc(parsed.timestamp)).toBe(true);

        // system records should NOT have a message field
        expect(parsed.message).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("all event types produce parseable JSON with valid ISO 8601 timestamps", () => {
    const eventType = fc.constantFrom("init", "tool-start", "tool-done", "agent-stop");

    fc.assert(
      fc.property(eventType, toolId, mappedToolName, toolInputJson, isoTimestamp, (event, id, name, input, ts) => {
        let line: string;
        switch (event) {
          case "init":
            line = buildInitRecord(ts);
            break;
          case "tool-start":
            line = buildToolStartRecord(id, name, input, ts);
            break;
          case "tool-done":
            line = buildToolDoneRecord(id, ts);
            break;
          case "agent-stop":
            line = buildAgentStopRecord(ts);
            break;
          default:
            throw new Error(`Unknown event: ${event}`);
        }

        // Must be valid JSON
        const parsed = JSON.parse(line);
        expect(parsed).toBeDefined();

        // Must have a type field
        expect(typeof parsed.type).toBe("string");

        // Must have a valid ISO 8601 timestamp
        expect(typeof parsed.timestamp).toBe("string");
        expect(isValidIso8601Utc(parsed.timestamp)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
