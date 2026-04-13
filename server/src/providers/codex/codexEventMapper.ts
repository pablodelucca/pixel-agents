import { formatToolStatus } from '../../../../src/transcriptParser.js';
import type { ProviderLifecycleEvent } from '../../providerEventRouter.js';

export interface CodexStructuredEvent {
  session_id: string;
  hook_event_name: string;
  method?: string;
  params?: Record<string, unknown>;
}

interface CodexLifecycleOptions {
  parentToolId?: string;
  isRootThread?: boolean;
}

interface CodexItem {
  id?: string;
  type?: string;
  command?: string;
  commandActions?: Array<{
    command?: string;
  }>;
  path?: string;
  filePath?: string;
  kind?: string;
  name?: string;
  tool?: string;
  prompt?: string | null;
  arguments?: Record<string, unknown>;
  source?: {
    type?: string;
    kind?: string;
    parentItemId?: string;
  };
}

export function mapCodexLifecycleEvents(
  agentId: number,
  event: CodexStructuredEvent,
  options: CodexLifecycleOptions = {},
): ProviderLifecycleEvent[] {
  if (event.hook_event_name !== 'CodexEvent' || typeof event.method !== 'string') {
    return [];
  }

  if (event.method === 'turn/completed') {
    if (options.isRootThread === false) {
      return [];
    }
    return [
      { type: 'turnCompleted', agentId },
      { type: 'waitingForInput', agentId },
    ];
  }

  if (
    event.method === 'item/commandExecution/requestApproval' ||
    event.method === 'item/fileChange/requestApproval' ||
    event.method === 'item/permissions/requestApproval'
  ) {
    return [
      {
        type: 'permissionRequested',
        agentId,
        toolId: typeof event.params?.itemId === 'string' ? event.params.itemId : undefined,
        parentToolId: options.parentToolId,
      },
    ];
  }

  const item = asCodexItem(event.params?.item);
  if (!item?.id || !item.type) {
    return [];
  }

  const parentToolId = options.parentToolId ?? getParentToolId(item);
  const mappedTool = mapCodexItemToTool(item);
  if (!mappedTool) {
    return [];
  }

  if (event.method === 'item/completed') {
    return [
      {
        type: 'toolCompleted',
        agentId,
        toolId: item.id,
        parentToolId,
      },
    ];
  }

  if (event.method !== 'item/started') {
    return [];
  }

  return [
    {
      type: 'toolStarted',
      agentId,
      toolId: item.id,
      toolName: mappedTool.toolName,
      status: mappedTool.status,
      parentToolId,
    },
  ];
}

function mapCodexItemToTool(item: CodexItem): { toolName: string; status: string } | undefined {
  if (item.type === 'commandExecution') {
    return mapCommandExecutionItem(item);
  }

  if (item.type === 'fileChange') {
    const filePath = item.filePath ?? item.path ?? '';
    const toolName = item.kind === 'write' ? 'Write' : 'Edit';
    return {
      toolName,
      status: formatToolStatus(toolName, { file_path: filePath }),
    };
  }

  if (item.type === 'toolCall') {
    const toolName = item.name ?? 'Tool';
    return {
      toolName,
      status: formatToolStatus(toolName, item.arguments ?? {}),
    };
  }

  if (item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent') {
    return {
      toolName: 'Agent',
      status: formatToolStatus('Agent', {
        description: typeof item.prompt === 'string' ? item.prompt.trim() : '',
      }),
    };
  }

  return undefined;
}

function mapCommandExecutionItem(item: CodexItem): { toolName: string; status: string } {
  const command = getDisplayCommand(item);
  const readPath = extractFilePath(command, ['Get-Content', 'gc', 'cat', 'type']);
  if (readPath) {
    return {
      toolName: 'Read',
      status: formatToolStatus('Read', { file_path: readPath }),
    };
  }

  if (looksLikeFileSearch(command)) {
    return {
      toolName: 'Glob',
      status: formatToolStatus('Glob', {}),
    };
  }

  if (looksLikeCodeSearch(command)) {
    return {
      toolName: 'Grep',
      status: formatToolStatus('Grep', {}),
    };
  }

  return {
    toolName: 'Bash',
    status: formatToolStatus('Bash', { command }),
  };
}

function getDisplayCommand(item: CodexItem): string {
  const actionCommand = item.commandActions?.find(
    (action) => typeof action.command === 'string',
  )?.command;
  if (actionCommand) {
    return actionCommand;
  }

  if (typeof item.command !== 'string') {
    return '';
  }

  const powershellMatch = item.command.match(/-Command\s+(?:"([\s\S]*)"|'([\s\S]*)')$/i);
  if (powershellMatch) {
    return (powershellMatch[1] ?? powershellMatch[2] ?? '').trim();
  }

  return item.command;
}

function extractFilePath(command: string, verbs: string[]): string | undefined {
  for (const verb of verbs) {
    const optionMatch = command.match(
      new RegExp(
        `\\b${escapeRegex(verb)}\\b\\s+-(?:LiteralPath|Path)\\s+(?:"([^"]+)"|'([^']+)'|([^\\s|;]+))`,
        'i',
      ),
    );
    const positionalMatch = command.match(
      new RegExp(`\\b${escapeRegex(verb)}\\b\\s+(?:"([^"]+)"|'([^']+)'|([^\\s|;]+))`, 'i'),
    );
    const match = optionMatch ?? positionalMatch;
    const extracted = match?.[1] ?? match?.[2] ?? match?.[3];
    if (extracted && !extracted.startsWith('-')) {
      return extracted.replace(/,$/, '');
    }
  }

  return undefined;
}

function looksLikeFileSearch(command: string): boolean {
  return (
    /\brg\b[\s\S]*\s--files\b/i.test(command) ||
    /\b(Get-ChildItem|ls|dir|Resolve-Path|Test-Path)\b/i.test(command)
  );
}

function looksLikeCodeSearch(command: string): boolean {
  return (
    /\b(rg|Select-String|grep|findstr)\b/i.test(command) &&
    !/\brg\b[\s\S]*\s--files\b/i.test(command)
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function asCodexItem(value: unknown): CodexItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as CodexItem;
}

function getParentToolId(item: CodexItem): string | undefined {
  const sourceType = item.source?.type ?? item.source?.kind;
  return sourceType === 'subAgent' ? item.source?.parentItemId : undefined;
}
