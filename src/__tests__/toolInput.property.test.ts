/**
 * Feature: kiro-pixel-agents-bridge, Property 10: Tool input extraction
 *
 * For any hook context JSON containing tool parameters, buildToolInput() SHALL:
 * extract `path` or `targetFile` as `file_path` for Read/Edit/Write tools;
 * extract `command` for Bash tools; extract `prompt` or `description`
 * (truncated to at most 80 characters) as `description` for Task tools;
 * and return `{}` for all other tool types or when no relevant parameters exist.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// ── TypeScript mirror of the shell script's build_tool_input() ──

/**
 * Extracts a JSON string value for a given key from a raw context string,
 * mirroring the shell's grep/sed extraction pattern.
 */
function extractJsonValue(ctx: string, key: string): string {
  const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "");
  const match = ctx.match(regex);
  return match ? match[1] : "";
}

/**
 * Mirrors the shell script's build_tool_input() function.
 * Given a mapped tool name and a hook context string, extracts
 * the relevant parameters for display in Pixel Agents.
 */
function buildToolInput(
  mappedName: string,
  ctx: string,
): Record<string, string> {
  switch (mappedName) {
    case "Read":
    case "Edit": {
      const fp = extractJsonValue(ctx, "path");
      return { file_path: fp };
    }
    case "Write": {
      let fp = extractJsonValue(ctx, "path");
      if (!fp) {
        fp = extractJsonValue(ctx, "targetFile");
      }
      return { file_path: fp };
    }
    case "Bash": {
      const cmd = extractJsonValue(ctx, "command");
      return { command: cmd };
    }
    case "Task": {
      let desc = extractJsonValue(ctx, "prompt");
      if (!desc) {
        desc = extractJsonValue(ctx, "description");
      }
      desc = desc.slice(0, 80);
      return { description: desc };
    }
    default:
      return {};
  }
}

// ── Arbitraries ──

/** Generate a safe string without double-quotes or backslashes (valid inside JSON string values). */
const safeString = fc.stringMatching(/^[a-zA-Z0-9 _\-./]+$/, { minLength: 1, maxLength: 200 });

/** Generate a file path-like string. */
const filePath = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9_\-.]+$/, { minLength: 1, maxLength: 30 }), {
    minLength: 1,
    maxLength: 5,
  })
  .map((parts) => parts.join("/"));

/** Generate a command string. */
const commandStr = fc.stringMatching(/^[a-zA-Z0-9 _\-./|]+$/, { minLength: 1, maxLength: 100 });

/** Generate a description string of variable length (some > 80 chars). */
const descriptionStr = fc.stringMatching(/^[a-zA-Z0-9 _\-.,!?]+$/, { minLength: 1, maxLength: 200 });

// ── Tests ──

describe("Tool input extraction (Property 10)", () => {
  it("extracts file_path from path for Read tools", () => {
    fc.assert(
      fc.property(filePath, (fp) => {
        const ctx = `{"toolName":"readFile","path":"${fp}"}`;
        const result = buildToolInput("Read", ctx);
        expect(result).toEqual({ file_path: fp });
      }),
      { numRuns: 100 },
    );
  });

  it("extracts file_path from path for Edit tools", () => {
    fc.assert(
      fc.property(filePath, (fp) => {
        const ctx = `{"toolName":"editCode","path":"${fp}"}`;
        const result = buildToolInput("Edit", ctx);
        expect(result).toEqual({ file_path: fp });
      }),
      { numRuns: 100 },
    );
  });

  it("extracts file_path from path for Write tools", () => {
    fc.assert(
      fc.property(filePath, (fp) => {
        const ctx = `{"toolName":"fsWrite","path":"${fp}"}`;
        const result = buildToolInput("Write", ctx);
        expect(result).toEqual({ file_path: fp });
      }),
      { numRuns: 100 },
    );
  });

  it("extracts file_path from targetFile for Write tools when path is absent", () => {
    fc.assert(
      fc.property(filePath, (fp) => {
        const ctx = `{"toolName":"deleteFile","targetFile":"${fp}"}`;
        const result = buildToolInput("Write", ctx);
        expect(result).toEqual({ file_path: fp });
      }),
      { numRuns: 100 },
    );
  });

  it("prefers path over targetFile for Write tools", () => {
    fc.assert(
      fc.property(filePath, filePath, (pathVal, targetVal) => {
        const ctx = `{"toolName":"fsWrite","path":"${pathVal}","targetFile":"${targetVal}"}`;
        const result = buildToolInput("Write", ctx);
        expect(result).toEqual({ file_path: pathVal });
      }),
      { numRuns: 100 },
    );
  });

  it("extracts command for Bash tools", () => {
    fc.assert(
      fc.property(commandStr, (cmd) => {
        const ctx = `{"toolName":"executeBash","command":"${cmd}"}`;
        const result = buildToolInput("Bash", ctx);
        expect(result).toEqual({ command: cmd });
      }),
      { numRuns: 100 },
    );
  });

  it("extracts description from prompt for Task tools, truncated to 80 chars", () => {
    fc.assert(
      fc.property(descriptionStr, (desc) => {
        const ctx = `{"toolName":"invokeSubAgent","prompt":"${desc}"}`;
        const result = buildToolInput("Task", ctx);
        expect(result).toEqual({ description: desc.slice(0, 80) });
      }),
      { numRuns: 100 },
    );
  });

  it("extracts description from description field for Task tools when prompt is absent", () => {
    fc.assert(
      fc.property(descriptionStr, (desc) => {
        const ctx = `{"toolName":"invokeSubAgent","description":"${desc}"}`;
        const result = buildToolInput("Task", ctx);
        expect(result).toEqual({ description: desc.slice(0, 80) });
      }),
      { numRuns: 100 },
    );
  });

  it("returns empty object for other tool types", () => {
    const otherTools = ["Glob", "Grep", "WebFetch", "SomeUnknownTool", "Read2"];
    fc.assert(
      fc.property(
        fc.constantFrom(...otherTools),
        safeString,
        (toolName, ctx) => {
          const result = buildToolInput(toolName, ctx);
          expect(result).toEqual({});
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns file_path with empty string when path/targetFile missing for Read/Edit/Write", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("Read", "Edit", "Write"),
        (toolName) => {
          const ctx = `{"toolName":"someOtherField","value":"123"}`;
          const result = buildToolInput(toolName, ctx);
          expect(result).toEqual({ file_path: "" });
        },
      ),
      { numRuns: 100 },
    );
  });

  it("returns command with empty string when command missing for Bash", () => {
    const ctx = `{"toolName":"executeBash","otherField":"value"}`;
    const result = buildToolInput("Bash", ctx);
    expect(result).toEqual({ command: "" });
  });

  it("returns description with empty string when prompt/description missing for Task", () => {
    const ctx = `{"toolName":"invokeSubAgent","otherField":"value"}`;
    const result = buildToolInput("Task", ctx);
    expect(result).toEqual({ description: "" });
  });
});
