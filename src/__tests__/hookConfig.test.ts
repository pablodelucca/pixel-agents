/**
 * Unit tests for Kiro hook configuration validity.
 *
 * Reads each hook JSON file and validates structure, event types,
 * command invocations, toolTypes filters, and enabled state.
 *
 * Validates: Requirements 7.1–7.5, 8.1
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const HOOKS_DIR = path.resolve(__dirname, "../../.kiro/hooks");

interface HookConfig {
  name: string;
  version: string;
  description?: string;
  enabled?: boolean;
  when: {
    type: string;
    toolTypes?: string[];
  };
  then: {
    type: string;
    command: string;
  };
}

const HOOK_FILES = [
  {
    filename: "pixel-agents-prompt.kiro.hook",
    expectedEventType: "promptSubmit",
    expectedCommand: "init",
  },
  {
    filename: "pixel-agents-tool-start.kiro.hook",
    expectedEventType: "preToolUse",
    expectedCommand: "tool-start",
  },
  {
    filename: "pixel-agents-tool-done.kiro.hook",
    expectedEventType: "postToolUse",
    expectedCommand: "tool-done",
  },
  {
    filename: "pixel-agents-agent-stop.kiro.hook",
    expectedEventType: "agentStop",
    expectedCommand: "agent-stop",
  },
];

describe("Hook configuration validity", () => {
  const hooks: Array<{ filename: string; config: HookConfig; expectedEventType: string; expectedCommand: string }> = [];

  // Parse all hook files upfront
  for (const hookDef of HOOK_FILES) {
    const filePath = path.join(HOOKS_DIR, hookDef.filename);
    const raw = fs.readFileSync(filePath, "utf-8");
    const config: HookConfig = JSON.parse(raw);
    hooks.push({ ...hookDef, config });
  }

  it("each hook file is valid JSON", () => {
    for (const hookDef of HOOK_FILES) {
      const filePath = path.join(HOOKS_DIR, hookDef.filename);
      const raw = fs.readFileSync(filePath, "utf-8");
      expect(() => JSON.parse(raw), `${hookDef.filename} should be valid JSON`).not.toThrow();
    }
  });

  it("each hook has required fields: name, version, when, then", () => {
    for (const { filename, config } of hooks) {
      expect(config.name, `${filename} missing name`).toBeDefined();
      expect(typeof config.name).toBe("string");
      expect(config.version, `${filename} missing version`).toBeDefined();
      expect(typeof config.version).toBe("string");
      expect(config.when, `${filename} missing when`).toBeDefined();
      expect(config.then, `${filename} missing then`).toBeDefined();
    }
  });

  it("when.type matches expected event type for each hook", () => {
    for (const { filename, config, expectedEventType } of hooks) {
      expect(config.when.type, `${filename} should have when.type = ${expectedEventType}`).toBe(expectedEventType);
    }
  });

  it("then.type is runCommand for all hooks", () => {
    for (const { filename, config } of hooks) {
      expect(config.then.type, `${filename} should have then.type = runCommand`).toBe("runCommand");
    }
  });

  it("then.command contains the correct bridge script invocation", () => {
    for (const { filename, config, expectedCommand } of hooks) {
      expect(
        config.then.command,
        `${filename} should invoke bridge with ${expectedCommand}`,
      ).toContain(`pixel-agents-bridge.sh ${expectedCommand}`);
    }
  });

  it("preToolUse and postToolUse hooks have toolTypes that do NOT include *", () => {
    const toolHooks = hooks.filter(
      (h) => h.config.when.type === "preToolUse" || h.config.when.type === "postToolUse",
    );
    expect(toolHooks.length).toBeGreaterThan(0);
    for (const { filename, config } of toolHooks) {
      expect(config.when.toolTypes, `${filename} should have toolTypes`).toBeDefined();
      expect(config.when.toolTypes, `${filename} toolTypes must not include *`).not.toContain("*");
    }
  });

  it('preToolUse and postToolUse hooks have toolTypes set to ["read", "write", "shell"]', () => {
    const toolHooks = hooks.filter(
      (h) => h.config.when.type === "preToolUse" || h.config.when.type === "postToolUse",
    );
    for (const { filename, config } of toolHooks) {
      expect(
        config.when.toolTypes,
        `${filename} should have toolTypes = ["read", "write", "shell"]`,
      ).toEqual(["read", "write", "shell"]);
    }
  });

  it("all hooks are enabled (enabled: true or absent)", () => {
    for (const { filename, config } of hooks) {
      if (config.enabled !== undefined) {
        expect(config.enabled, `${filename} should be enabled`).toBe(true);
      }
      // If enabled is absent, the hook is considered enabled by default — that's valid
    }
  });
});
