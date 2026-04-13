import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  copyClaudeHookScript,
  installClaudeHooks,
  uninstallClaudeHooks,
} from '../../../server/src/providers/file/claudeHookInstaller.js';
import type {
  ProviderAdapter,
  ProviderLaunchPlan,
  ProviderLaunchRequest,
} from '../providerAdapter.js';
import type { ProviderDescriptor } from '../providerTypes.js';

const CLAUDE_DESCRIPTOR: ProviderDescriptor = {
  id: 'claude',
  displayName: 'Claude Code',
  terminalPrefix: 'Claude Code',
  supportsExternalDiscovery: true,
  supportsStructuredEvents: true,
};

function workspacePathToProjectDirName(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
}

function resolveClaudeProjectDir(projectDir: string, dirName: string): string {
  if (fs.existsSync(projectDir)) {
    return projectDir;
  }

  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  try {
    if (fs.existsSync(projectsRoot)) {
      const candidates = fs.readdirSync(projectsRoot);
      const lowerDirName = dirName.toLowerCase();
      const match = candidates.find((candidate) => candidate.toLowerCase() === lowerDirName);
      if (match && match !== dirName) {
        console.log(
          `[Pixel Agents] Claude: project dir not found, using case-insensitive match: ${dirName} -> ${match}`,
        );
        return path.join(projectsRoot, match);
      }
      if (!match) {
        console.warn(
          `[Pixel Agents] Claude: project dir does not exist: ${projectDir}. ` +
            `Available dirs (${candidates.length}): ${candidates.slice(0, 5).join(', ')}${candidates.length > 5 ? '...' : ''}`,
        );
      }
    }
  } catch {
    // Ignore scan errors and keep the canonical path.
  }

  return projectDir;
}

function buildClaudeLaunchPlan({
  sessionId,
  bypassPermissions,
}: ProviderLaunchRequest): ProviderLaunchPlan {
  return {
    command: bypassPermissions
      ? `claude --session-id ${sessionId} --dangerously-skip-permissions`
      : `claude --session-id ${sessionId}`,
  };
}

export const claudeProvider: ProviderAdapter = {
  id: 'claude',
  descriptor: CLAUDE_DESCRIPTOR,
  usesTranscriptFile: true,
  terminalLabel(index: number): string {
    return `${CLAUDE_DESCRIPTOR.terminalPrefix} #${index}`;
  },
  matchesTerminalLabel(terminalName: string): boolean {
    return terminalName.startsWith(CLAUDE_DESCRIPTOR.terminalPrefix);
  },
  buildLaunchPlan: buildClaudeLaunchPlan,
  getProjectDir(cwd?: string): string {
    const workspacePath = cwd || os.homedir();
    const dirName = workspacePathToProjectDirName(workspacePath);
    const projectDir = path.join(os.homedir(), '.claude', 'projects', dirName);

    console.log(`[Pixel Agents] Claude: Project dir: ${workspacePath} -> ${dirName}`);

    return resolveClaudeProjectDir(projectDir, dirName);
  },
  getProjectsRoot(): string {
    return path.join(os.homedir(), '.claude', 'projects');
  },
  installIntegration(extensionPath: string): void {
    installClaudeHooks();
    copyClaudeHookScript(extensionPath);
  },
  uninstallIntegration(): void {
    uninstallClaudeHooks();
  },
};
