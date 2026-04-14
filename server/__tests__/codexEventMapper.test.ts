import { describe, expect, it } from 'vitest';

import { mapCodexLifecycleEvents } from '../src/providers/codex/codexEventMapper.js';

describe('mapCodexLifecycleEvents', () => {
  it('maps command execution items to a Bash-like active tool event', () => {
    expect(
      mapCodexLifecycleEvents(7, {
        session_id: 'sess-1',
        hook_event_name: 'CodexEvent',
        method: 'item/started',
        params: {
          item: {
            id: 'cmd_1',
            type: 'commandExecution',
            command: 'npm run lint',
          },
        },
      }),
    ).toEqual([
      {
        type: 'toolStarted',
        agentId: 7,
        toolId: 'cmd_1',
        toolName: 'Bash',
        status: 'Running: npm run lint',
      },
    ]);
  });

  it('maps Get-Content command executions to a Read status', () => {
    expect(
      mapCodexLifecycleEvents(7, {
        session_id: 'sess-1',
        hook_event_name: 'CodexEvent',
        method: 'item/started',
        params: {
          item: {
            id: 'cmd_read',
            type: 'commandExecution',
            command:
              '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "Get-Content server\\\\src\\\\providerEventRouter.ts -TotalCount 260"',
            commandActions: [
              {
                command: 'Get-Content server\\src\\providerEventRouter.ts -TotalCount 260',
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        type: 'toolStarted',
        agentId: 7,
        toolId: 'cmd_read',
        toolName: 'Read',
        status: 'Reading providerEventRouter.ts',
      },
    ]);
  });

  it('maps rg --files command executions to a Glob-like status', () => {
    expect(
      mapCodexLifecycleEvents(7, {
        session_id: 'sess-1',
        hook_event_name: 'CodexEvent',
        method: 'item/started',
        params: {
          item: {
            id: 'cmd_glob',
            type: 'commandExecution',
            command:
              '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "rg --files -g README* -g package.json"',
            commandActions: [
              {
                command: 'rg --files -g README* -g package.json',
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        type: 'toolStarted',
        agentId: 7,
        toolId: 'cmd_glob',
        toolName: 'Glob',
        status: 'Searching files',
      },
    ]);
  });

  it('maps rg content searches to a Grep-like status', () => {
    expect(
      mapCodexLifecycleEvents(7, {
        session_id: 'sess-1',
        hook_event_name: 'CodexEvent',
        method: 'item/started',
        params: {
          item: {
            id: 'cmd_grep',
            type: 'commandExecution',
            command:
              '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command "rg -n provider src server"',
            commandActions: [
              {
                command: 'rg -n provider src server',
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        type: 'toolStarted',
        agentId: 7,
        toolId: 'cmd_grep',
        toolName: 'Grep',
        status: 'Searching code',
      },
    ]);
  });

  it('maps approval requests to a permission event for the active tool', () => {
    expect(
      mapCodexLifecycleEvents(7, {
        session_id: 'sess-1',
        hook_event_name: 'CodexEvent',
        method: 'item/commandExecution/requestApproval',
        params: {
          itemId: 'cmd_1',
        },
      }),
    ).toEqual([
      {
        type: 'permissionRequested',
        agentId: 7,
        toolId: 'cmd_1',
      },
    ]);
  });

  it('maps turn completion to waiting and turn-complete events', () => {
    expect(
      mapCodexLifecycleEvents(7, {
        session_id: 'sess-1',
        hook_event_name: 'CodexEvent',
        method: 'turn/completed',
        params: {
          turn: {
            id: 'turn_1',
            status: 'completed',
          },
        },
      }),
    ).toEqual([
      {
        type: 'turnCompleted',
        agentId: 7,
      },
      {
        type: 'waitingForInput',
        agentId: 7,
      },
    ]);
  });

  it('keeps sub-agent items attached to their parent tool', () => {
    expect(
      mapCodexLifecycleEvents(7, {
        session_id: 'sess-1',
        hook_event_name: 'CodexEvent',
        method: 'item/started',
        params: {
          item: {
            id: 'cmd_2',
            type: 'commandExecution',
            command: 'rg TODO',
            source: {
              type: 'subAgent',
              parentItemId: 'task_1',
            },
          },
        },
      }),
    ).toEqual([
      {
        type: 'toolStarted',
        agentId: 7,
        toolId: 'cmd_2',
        toolName: 'Grep',
        status: 'Searching code',
        parentToolId: 'task_1',
      },
    ]);
  });

  it('maps spawnAgent collaboration calls to Agent status text', () => {
    const result = mapCodexLifecycleEvents(7, {
      session_id: 'sess-1',
      hook_event_name: 'CodexEvent',
      method: 'item/started',
      params: {
        item: {
          id: 'call_spawn_1',
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: 'Inspect src/providers and summarize the architecture',
        },
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'toolStarted',
      agentId: 7,
      toolId: 'call_spawn_1',
      toolName: 'Agent',
    });
    expect(result[0]?.type).toBe('toolStarted');
    if (result[0]?.type === 'toolStarted') {
      expect(result[0].status).toContain('Subtask: Inspect src/providers');
    }
  });

  it('ignores non-root turn completion notifications', () => {
    expect(
      mapCodexLifecycleEvents(
        7,
        {
          session_id: 'sess-1',
          hook_event_name: 'CodexEvent',
          method: 'turn/completed',
          params: {
            threadId: 'child-thread',
            turn: {
              id: 'turn_child_1',
              status: 'completed',
            },
          },
        },
        {
          isRootThread: false,
        },
      ),
    ).toEqual([]);
  });
});
