import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const AGENT_PROVIDER_ID = {
  CLAUDE: 'claude',
  CODEX: 'codex',
  GEMINI: 'gemini',
  CUSTOM: 'custom',
} as const;

export type AgentProviderId = (typeof AGENT_PROVIDER_ID)[keyof typeof AGENT_PROVIDER_ID];

export interface StoredAgentProviderConfig {
  id: AgentProviderId;
  customCommand?: string;
  customDisplayName?: string;
  customProjectsRoot?: string;
}

export interface AgentProviderRuntime {
  id: AgentProviderId;
  displayName: string;
  terminalNamePrefix: string;
  projectsRoot: string;
  supportsBypassPermissions: boolean;
  buildLaunchCommand: (sessionId: string, bypassPermissions?: boolean) => string;
}

const SESSION_ID_PLACEHOLDER = '{sessionId}';
const BYPASS_FLAG_PLACEHOLDER = '{bypassFlag}';
const CLAUDE_BYPASS_FLAG = '--dangerously-skip-permissions';

const CUSTOM_DEFAULT_COMMAND = `my-agent-cli --session-id ${SESSION_ID_PLACEHOLDER}`;
const CUSTOM_DEFAULT_DISPLAY_NAME = 'Custom Agent';
const CUSTOM_DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), '.pixel-agents', 'projects');

interface ProviderPreset {
  id: Exclude<AgentProviderId, 'custom'>;
  displayName: string;
  terminalNamePrefix: string;
  command: string;
  projectsRootCandidates: string[];
  supportsBypassPermissions: boolean;
}

const PROVIDER_PRESETS: Record<Exclude<AgentProviderId, 'custom'>, ProviderPreset> = {
  claude: {
    id: AGENT_PROVIDER_ID.CLAUDE,
    displayName: 'Claude Code',
    terminalNamePrefix: 'Claude Code',
    command: 'claude',
    projectsRootCandidates: [path.join(os.homedir(), '.claude', 'projects')],
    supportsBypassPermissions: true,
  },
  codex: {
    id: AGENT_PROVIDER_ID.CODEX,
    displayName: 'Codex',
    terminalNamePrefix: 'Codex',
    command: 'codex',
    projectsRootCandidates: [
      path.join(os.homedir(), '.codex', 'sessions'),
      path.join(os.homedir(), '.Codex', 'sessions'),
      path.join(os.homedir(), '.codex', 'projects'),
      path.join(os.homedir(), '.Codex', 'projects'),
    ],
    supportsBypassPermissions: false,
  },
  gemini: {
    id: AGENT_PROVIDER_ID.GEMINI,
    displayName: 'Gemini CLI',
    terminalNamePrefix: 'Gemini',
    command: 'gemini',
    projectsRootCandidates: [
      path.join(os.homedir(), '.gemini', 'projects'),
      path.join(os.homedir(), '.Gemini', 'projects'),
    ],
    supportsBypassPermissions: false,
  },
};

function pickExistingPath(paths: string[]): string {
  for (const candidate of paths) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return paths[0];
}

function normalizeCustomPath(rawPath: string | undefined): string {
  const value = rawPath?.trim();
  if (!value) return CUSTOM_DEFAULT_PROJECTS_ROOT;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

function buildPresetCommand(
  preset: ProviderPreset,
  sessionId: string,
  bypassPermissions?: boolean,
): string {
  if (preset.id === AGENT_PROVIDER_ID.CODEX) {
    return `${preset.command} --no-alt-screen`;
  }

  let cmd = `${preset.command} --session-id ${sessionId}`;
  if (preset.supportsBypassPermissions && bypassPermissions) {
    cmd += ` ${CLAUDE_BYPASS_FLAG}`;
  }
  return cmd;
}

function buildCustomCommand(
  template: string,
  sessionId: string,
  bypassPermissions?: boolean,
): string {
  let cmd = template.includes(SESSION_ID_PLACEHOLDER)
    ? template.replaceAll(SESSION_ID_PLACEHOLDER, sessionId)
    : `${template} --session-id ${sessionId}`;

  if (cmd.includes(BYPASS_FLAG_PLACEHOLDER)) {
    cmd = cmd.replaceAll(BYPASS_FLAG_PLACEHOLDER, bypassPermissions ? CLAUDE_BYPASS_FLAG : '');
  }

  return cmd.replace(/\s+/g, ' ').trim();
}

export function resolveProviderRuntime(
  provider: StoredAgentProviderConfig | undefined,
): AgentProviderRuntime {
  const id = provider?.id ?? AGENT_PROVIDER_ID.CLAUDE;

  if (id === AGENT_PROVIDER_ID.CUSTOM) {
    const commandTemplate = provider?.customCommand?.trim() || CUSTOM_DEFAULT_COMMAND;
    const displayName = provider?.customDisplayName?.trim() || CUSTOM_DEFAULT_DISPLAY_NAME;
    const projectsRoot = normalizeCustomPath(provider?.customProjectsRoot);
    const supportsBypassPermissions = commandTemplate.includes(BYPASS_FLAG_PLACEHOLDER);

    return {
      id,
      displayName,
      terminalNamePrefix: displayName,
      projectsRoot,
      supportsBypassPermissions,
      buildLaunchCommand: (sessionId: string, bypassPermissions?: boolean) =>
        buildCustomCommand(commandTemplate, sessionId, bypassPermissions),
    };
  }

  const preset = PROVIDER_PRESETS[id] ?? PROVIDER_PRESETS.claude;
  const projectsRoot = pickExistingPath(preset.projectsRootCandidates);

  return {
    id: preset.id,
    displayName: preset.displayName,
    terminalNamePrefix: preset.terminalNamePrefix,
    projectsRoot,
    supportsBypassPermissions: preset.supportsBypassPermissions,
    buildLaunchCommand: (sessionId: string, bypassPermissions?: boolean) =>
      buildPresetCommand(preset, sessionId, bypassPermissions),
  };
}

export function getCustomProviderDefaults(): {
  commandTemplate: string;
  displayName: string;
  projectsRoot: string;
} {
  return {
    commandTemplate: CUSTOM_DEFAULT_COMMAND,
    displayName: CUSTOM_DEFAULT_DISPLAY_NAME,
    projectsRoot: CUSTOM_DEFAULT_PROJECTS_ROOT,
  };
}
