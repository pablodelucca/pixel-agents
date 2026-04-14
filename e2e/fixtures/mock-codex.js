#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

function getHomeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function appendInvocationLog() {
  const logDir = path.join(getHomeDir(), '.codex-mock');
  fs.mkdirSync(logDir, { recursive: true });
  const sessionId = process.env.PIXEL_AGENTS_SESSION_ID || '';
  fs.appendFileSync(
    path.join(logDir, 'invocations.log'),
    `${new Date().toISOString()} session-id=${sessionId} cwd=${process.cwd()} args=${process.argv.slice(2).join(' ')}\n`,
    'utf8',
  );
}

function appendTrace(message) {
  const logDir = path.join(getHomeDir(), '.codex-mock');
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(
    path.join(logDir, 'invocations.log'),
    `${new Date().toISOString()} trace=${message}\n`,
    'utf8',
  );
}

function sendMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function getThreadId(params, fallbackId) {
  return params && typeof params.threadId === 'string' ? params.threadId : fallbackId;
}

function getInputText(params) {
  if (!params || !Array.isArray(params.input)) return '';
  for (const item of params.input) {
    if (item && typeof item === 'object' && typeof item.text === 'string') {
      return item.text;
    }
  }
  return '';
}

function emitSpawnAgentScenario(threadId, turnId) {
  appendTrace(`emit-spawn-agent thread=${threadId} child=spawn_1 turn=${turnId}`);
  sendMessage({
    method: 'item/started',
    params: {
      threadId,
      item: {
        id: 'spawn_1',
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        prompt: 'Inspect src/providers',
      },
    },
  });
  sendMessage({
    method: 'item/started',
    params: {
      threadId,
      item: {
        id: 'cmd_child_1',
        type: 'commandExecution',
        command: 'rg TODO src/providers',
        source: {
          type: 'subAgent',
          parentItemId: 'spawn_1',
        },
      },
    },
  });
}

function emitMultiSpawnAgentScenario(threadId, turnId) {
  const subtasks = [
    {
      spawnId: 'spawn_1',
      childId: 'cmd_child_1',
      prompt: 'Inspect providerTypes',
      command: 'Get-Content src/providers/providerTypes.ts',
    },
    {
      spawnId: 'spawn_2',
      childId: 'cmd_child_2',
      prompt: 'Inspect providerRegistry',
      command: 'Get-Content src/providers/providerRegistry.ts',
    },
    {
      spawnId: 'spawn_3',
      childId: 'cmd_child_3',
      prompt: 'Inspect claudeProvider',
      command: 'Get-Content src/providers/claude/claudeProvider.ts',
    },
    {
      spawnId: 'spawn_4',
      childId: 'cmd_child_4',
      prompt: 'Inspect codexProvider',
      command: 'Get-Content src/providers/codex/codexProvider.ts',
    },
    {
      spawnId: 'spawn_5',
      childId: 'cmd_child_5',
      prompt: 'Inspect providerEventRouter',
      command: 'Get-Content server/src/providerEventRouter.ts',
    },
    {
      spawnId: 'spawn_6',
      childId: 'cmd_child_6',
      prompt: 'Inspect codexEventMapper',
      command: 'Get-Content server/src/providers/codex/codexEventMapper.ts',
    },
  ];

  appendTrace(`emit-spawn-agent-many thread=${threadId} count=${subtasks.length} turn=${turnId}`);
  for (const subtask of subtasks) {
    sendMessage({
      method: 'item/started',
      params: {
        threadId,
        item: {
          id: subtask.spawnId,
          type: 'collabAgentToolCall',
          tool: 'spawnAgent',
          prompt: subtask.prompt,
        },
      },
    });
    sendMessage({
      method: 'item/started',
      params: {
        threadId,
        item: {
          id: subtask.childId,
          type: 'commandExecution',
          command: subtask.command,
          source: {
            type: 'subAgent',
            parentItemId: subtask.spawnId,
          },
        },
      },
    });
  }
}

appendInvocationLog();

if (process.argv[2] !== 'app-server') {
  process.stderr.write('mock-codex only supports "codex app-server --listen stdio://"\n');
  process.exit(1);
}

let nextThreadId = 1;
let nextTurnId = 1;
const scenario = process.env.PIXEL_AGENTS_CODEX_SCENARIO || 'default';

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (typeof message.method !== 'string' || message.id === undefined) {
    return;
  }

  appendTrace(`request method=${message.method}`);

  if (message.method === 'initialize') {
    sendMessage({
      id: message.id,
      result: {
        codexHome: path.join(getHomeDir(), '.codex'),
        platformOs: process.platform,
        platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
      },
    });
    return;
  }

  if (message.method === 'thread/start') {
    const threadId = `mock-thread-${nextThreadId++}`;
    sendMessage({
      id: message.id,
      result: {
        thread: { id: threadId },
      },
    });
    sendMessage({
      method: 'thread/started',
      params: {
        thread: { id: threadId },
      },
    });
    if (scenario === 'spawn-agent') {
      appendTrace(`scenario=${scenario} thread=${threadId}`);
      setTimeout(() => emitSpawnAgentScenario(threadId, 'scenario'), 750);
    }
    if (scenario === 'spawn-agent-many') {
      appendTrace(`scenario=${scenario} thread=${threadId}`);
      setTimeout(() => emitMultiSpawnAgentScenario(threadId, 'scenario'), 750);
    }
    return;
  }

  if (message.method === 'turn/start') {
    const turnId = `mock-turn-${nextTurnId++}`;
    const threadId = getThreadId(message.params, 'mock-thread-1');
    const inputText = getInputText(message.params);
    sendMessage({
      id: message.id,
      result: {
        turn: { id: turnId },
        thread: { id: threadId },
      },
    });
    sendMessage({
      method: 'turn/started',
      params: {
        turn: { id: turnId },
        thread: { id: threadId },
      },
    });
    if (inputText === 'spawn-agent-demo') {
      emitSpawnAgentScenario(threadId, turnId);
      return;
    }
    if (inputText === 'spawn-agent-many-demo') {
      emitMultiSpawnAgentScenario(threadId, turnId);
      return;
    }
    sendMessage({
      method: 'item/agentMessage/delta',
      params: {
        turn: { id: turnId },
        delta: 'mock-codex-response',
      },
    });
    sendMessage({
      method: 'turn/completed',
      params: {
        turn: { id: turnId, status: 'completed' },
        thread: { id: threadId },
      },
    });
    return;
  }

  sendMessage({
    id: message.id,
    result: {},
  });
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
