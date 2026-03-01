/**
 * Dev-mode backend for standalone webview development.
 * Runs alongside Vite to provide the missing VS Code extension host functionality:
 * - WebSocket bridge for postMessage communication
 * - Spawns localAgent.js processes when "+ Agent" is clicked
 * - Watches .jsonl transcript files and forwards events to the browser
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ── Config ──────────────────────────────────────────────────
const WS_PORT = 3100;
const POLL_INTERVAL_MS = 500;
const AUTO_MODE_DURATION_DEFAULT_MS = 5 * 60 * 1000; // 5 minutes
const AUTO_MODE_TERMINATION_KEYWORD = '[CONVERSATION_END]';

const SEED_PROMPTS = [
    'Hello! I am a curious programmer. I have been thinking about the trade-offs between monorepos and polyrepos. What are your thoughts on when to use each approach?',
    'Hi there! I have been exploring different state management patterns in frontend applications. Redux, MobX, Zustand, signals - what has been your experience with these?',
    'Hey! I am working on a side project and trying to decide between GraphQL and REST for the API. What factors would you consider when making this choice?',
    'Greetings! I have been reading about event-driven architecture and message queues. How do you approach designing systems with eventual consistency?',
    'Hello! I am curious about testing strategies. What is your take on the balance between unit tests, integration tests, and end-to-end tests?',
    'Hi! I have been thinking about code review culture. What makes a code review process effective without becoming a bottleneck?',
    'Hey there! I am exploring different database choices for a new project. When would you choose PostgreSQL over MongoDB or vice versa?',
    'Greetings! I have been learning about containerization and orchestration. Docker vs Kubernetes - when do you actually need orchestration?',
    'Hello! I am curious about CI/CD pipelines. What are some common mistakes teams make when setting up their deployment automation?',
    'Hi! I have been thinking about technical debt. How do you balance shipping features quickly while maintaining code quality long-term?',
];

// ── Load .env from project root ─────────────────────────────
function loadEnv(): Record<string, string> {
    const envPath = path.join(__dirname, '..', '.env');
    const env: Record<string, string> = {};
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
        }
    }
    return env;
}

// ── Project directory (mirrors getProjectDirPath in extension) ──
function getProjectDirPath(): string {
    const cwd = path.resolve(__dirname, '..');
    const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', dirName);
}

// ── Transcript line parser (simplified version of transcriptParser.ts) ──
function parseTranscriptLine(line: string, agentId: number): { event: Record<string, unknown> | null; assistantText?: string; isTurnEnd?: boolean; terminationDetected?: boolean } {
    try {
        const record = JSON.parse(line);

        if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
            const blocks = record.message.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>;
            const hasToolUse = blocks.some((b: { type: string }) => b.type === 'tool_use');

            if (hasToolUse) {
                const tools = blocks
                    .filter((b: { type: string }) => b.type === 'tool_use')
                    .map((b: { id?: string; name?: string; input?: Record<string, unknown> }) => ({
                        toolId: b.id,
                        status: `Using ${b.name || 'tool'}`,
                    }));
                return { event: { type: 'agentToolStart', id: agentId, tools } };
            }
            
            const textBlock = blocks.find((b: { type: string }) => b.type === 'text');
            let assistantText = textBlock?.text || '';
            const terminationDetected = assistantText.includes(AUTO_MODE_TERMINATION_KEYWORD);
            
            if (terminationDetected) {
                assistantText = assistantText.replace(AUTO_MODE_TERMINATION_KEYWORD, '').trim();
            }
            
            return { event: { type: 'agentStatus', id: agentId, status: 'active' }, assistantText, terminationDetected };
        }

        if (record.type === 'user') {
            const content = record.message?.content;
            if (Array.isArray(content)) {
                const hasToolResult = content.some((b: { type: string }) => b.type === 'tool_result');
                if (hasToolResult) {
                    const toolIds = content
                        .filter((b: { type: string }) => b.type === 'tool_result')
                        .map((b: { tool_use_id?: string }) => b.tool_use_id);
                    return { event: { type: 'agentToolDone', id: agentId, toolIds } };
                }
            }
        }

        if (record.type === 'system' && record.subtype === 'turn_duration') {
            return { event: { type: 'agentStatus', id: agentId, status: 'waiting' }, isTurnEnd: true };
        }

        return { event: null };
    } catch {
        return { event: null };
    }
}

// ── State ───────────────────────────────────────────────────
interface AgentProcess {
    id: number;
    process: ChildProcess;
    jsonlFile: string;
    fileOffset: number;
    lastAssistantText?: string;
}

interface AutoModeState {
    agentIds: [number, number];
    currentAgentIndex: number;
    isActive: boolean;
    startTime: number;
    durationTimer: ReturnType<typeof setTimeout>;
}

const agents = new Map<number, AgentProcess>();
let nextAgentId = 1;
const clients = new Set<WebSocket>();
let autoMode: AutoModeState | null = null;

// ── Broadcast to all connected browser clients ──────────────
function broadcast(msg: Record<string, unknown>): void {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
        if (ws.readyState === 1) { // OPEN
            ws.send(data);
        }
    }
}

// ── Poll .jsonl file for new lines ──────────────────────────
function pollJsonl(agent: AgentProcess): void {
    if (!fs.existsSync(agent.jsonlFile)) return;

    const stat = fs.statSync(agent.jsonlFile);
    if (stat.size <= agent.fileOffset) return;

    const fd = fs.openSync(agent.jsonlFile, 'r');
    const buf = Buffer.alloc(stat.size - agent.fileOffset);
    fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
    fs.closeSync(fd);
    agent.fileOffset = stat.size;

    const lines = buf.toString('utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
        const { event, assistantText, isTurnEnd, terminationDetected } = parseTranscriptLine(line, agent.id);
        
        if (assistantText !== undefined) {
            agent.lastAssistantText = assistantText;
            broadcast({ type: 'agentMessage', id: agent.id, text: assistantText });
        }
        
        if (event) {
            broadcast(event);
        }
        
        if (terminationDetected && autoMode?.isActive) {
            console.log('[DevServer] Auto mode: Termination keyword detected, stopping');
            stopAutoMode();
        } else if (isTurnEnd && autoMode?.isActive) {
            handleAutoModeTurnEnd(agent);
        }
    }
}

// ── Handle auto mode turn passing ───────────────────────────
function handleAutoModeTurnEnd(completedAgent: AgentProcess): void {
    if (!autoMode?.isActive) return;
    
    const { agentIds, currentAgentIndex } = autoMode;
    const currentId = agentIds[currentAgentIndex];
    
    if (completedAgent.id !== currentId) return;
    
    const nextIndex = (currentAgentIndex + 1) % 2;
    const nextAgentId = agentIds[nextIndex];
    const nextAgent = agents.get(nextAgentId);
    
    if (!nextAgent) {
        console.log('[DevServer] Auto mode: next agent not found, stopping');
        clearTimeout(autoMode.durationTimer);
        broadcast({ type: 'autoModeEnded' });
        autoMode = null;
        return;
    }
    
    const responseText = completedAgent.lastAssistantText || 'Please continue the conversation.';
    console.log(`[DevServer] Auto mode: Agent #${completedAgent.id} -> Agent #${nextAgentId}`);
    
    if (nextAgent.process.stdin) {
        nextAgent.process.stdin.write(responseText + '\n');
    }
    
    autoMode.currentAgentIndex = nextIndex;
}

// ── Spawn a local agent process ─────────────────────────────
function spawnAgent(): number | null {
    const env = loadEnv();
    const projectDir = getProjectDirPath();
    const sessionId = crypto.randomUUID();
    const agentId = nextAgentId++;

    fs.mkdirSync(projectDir, { recursive: true });
    const jsonlFile = path.join(projectDir, `${sessionId}.jsonl`);

    const agentScript = path.join(__dirname, '..', 'dist', 'localAgent.js');
    if (!fs.existsSync(agentScript)) {
        console.error(`[DevServer] ❌ localAgent.js not found at ${agentScript}. Run "npm run compile" first.`);
        broadcast({ type: 'error', message: 'localAgent.js not built. Run npm run compile first.' });
        return null;
    }

    const proc = spawn('node', [
        agentScript,
        '--session-id', sessionId,
        '--base-url', env.PIXEL_AGENTS_BASE_URL || 'http://localhost:1234/v1',
        '--api-key', env.PIXEL_AGENTS_API_KEY || 'lmstudio',
        '--model', env.PIXEL_AGENTS_MODEL || 'local-model',
        '--project-dir', projectDir,
    ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(__dirname, '..'),
    });

    const agent: AgentProcess = { id: agentId, process: proc, jsonlFile, fileOffset: 0 };
    agents.set(agentId, agent);

    console.log(`[DevServer] 🤖 Agent #${agentId} spawned (session: ${sessionId})`);
    broadcast({ type: 'agentCreated', id: agentId });

    proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(`[Agent#${agentId}] ${text}`);
    });
    proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stderr.write(`[Agent#${agentId}] ${text}`);
    });

    proc.on('exit', (code) => {
        console.log(`[DevServer] Agent #${agentId} exited (code: ${code})`);
        agents.delete(agentId);
        broadcast({ type: 'agentClosed', id: agentId });
        if (autoMode?.agentIds.includes(agentId)) {
            clearTimeout(autoMode.durationTimer);
            broadcast({ type: 'autoModeEnded' });
            autoMode = null;
        }
    });

    const pollInterval = setInterval(() => {
        if (!agents.has(agentId)) {
            clearInterval(pollInterval);
            return;
        }
        pollJsonl(agent);
    }, POLL_INTERVAL_MS);
    
    return agentId;
}

// ── Stop Auto Mode ──────────────────────────────────────────
function stopAutoMode(): void {
    if (!autoMode) return;
    
    console.log('[DevServer] 🛑 Auto mode stopped');
    clearTimeout(autoMode.durationTimer);
    broadcast({ type: 'autoModeEnded' });
    autoMode = null;
}

// ── Start Auto Mode ──────────────────────────────────────────
function startAutoMode(): void {
    if (autoMode?.isActive) {
        console.log('[DevServer] Auto mode already active');
        return;
    }
    
    console.log('[DevServer] 🎭 Starting Auto Mode...');
    
    const agent1Id = spawnAgent();
    if (agent1Id === null) {
        broadcast({ type: 'error', message: 'Failed to spawn first agent for auto mode' });
        return;
    }
    
    const agent2Id = spawnAgent();
    if (agent2Id === null) {
        broadcast({ type: 'error', message: 'Failed to spawn second agent for auto mode' });
        const agent1 = agents.get(agent1Id);
        if (agent1) agent1.process.kill();
        return;
    }
    
    const env = loadEnv();
    const durationMs = parseInt(env.PIXEL_AGENTS_AUTO_MODE_DURATION_MS || '', 10) || AUTO_MODE_DURATION_DEFAULT_MS;
    const startTime = Date.now();
    
    const durationTimer = setTimeout(() => {
        console.log(`[DevServer] Auto mode duration (${durationMs / 1000}s) reached, stopping`);
        stopAutoMode();
    }, durationMs);
    
    autoMode = {
        agentIds: [agent1Id, agent2Id] as [number, number],
        currentAgentIndex: 0,
        isActive: true,
        startTime,
        durationTimer,
    };
    
    console.log(`[DevServer] Auto mode: Agent #${agent1Id} and #${agent2Id} spawned (duration: ${durationMs / 1000}s)`);
    
    const randomPrompt = SEED_PROMPTS[Math.floor(Math.random() * SEED_PROMPTS.length)];
    
    setTimeout(() => {
        const agent1 = agents.get(agent1Id);
        if (agent1?.process.stdin && autoMode?.isActive) {
            agent1.process.stdin.write(randomPrompt + '\n');
            console.log(`[DevServer] Auto mode: Seeded conversation to Agent #${agent1Id}`);
        }
    }, 2000);
}

// ── Handle messages from the browser ────────────────────────
function handleClientMessage(ws: WebSocket, raw: string): void {
    try {
        const msg = JSON.parse(raw);

        if (msg.type === 'openClaude') {
            spawnAgent();
        } else if (msg.type === 'startAutoMode') {
            startAutoMode();
        } else if (msg.type === 'closeAgent') {
            const agent = agents.get(msg.id);
            if (agent) {
                agent.process.kill();
            }
        } else if (msg.type === 'focusAgent') {
            // No-op in dev mode (no terminal to focus)
        } else if (msg.type === 'webviewReady') {
            // Send initial state
            ws.send(JSON.stringify({ type: 'settingsLoaded', soundEnabled: false }));
            ws.send(JSON.stringify({ type: 'layoutLoaded', layout: null }));
            // Send existing agents
            for (const [id] of agents) {
                ws.send(JSON.stringify({ type: 'agentCreated', id }));
            }
        } else if (msg.type === 'stdinInput') {
            // Forward user input to agent's stdin
            const agent = agents.get(msg.id);
            if (agent && agent.process.stdin) {
                agent.process.stdin.write(msg.text + '\n');
            }
        }
    } catch (err) {
        console.error('[DevServer] Failed to parse message:', err);
    }
}

// ── Start WebSocket server ──────────────────────────────────
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws: WebSocket) => {
    console.log('[DevServer] 🔌 Browser connected');
    clients.add(ws);

    ws.on('message', (data: Buffer) => {
        handleClientMessage(ws, data.toString());
    });

    ws.on('close', () => {
        console.log('[DevServer] Browser disconnected');
        clients.delete(ws);
    });
});

console.log(`
\x1b[36m╔══════════════════════════════════════════╗\x1b[0m
\x1b[36m║\x1b[0m  \x1b[1mPixel Agents Dev Server\x1b[0m                 \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  WebSocket: \x1b[33mws://localhost:${WS_PORT}\x1b[0m          \x1b[36m║\x1b[0m
\x1b[36m║\x1b[0m  Status: \x1b[32mReady\x1b[0m                            \x1b[36m║\x1b[0m
\x1b[36m╚══════════════════════════════════════════╝\x1b[0m
\x1b[2mWaiting for browser connection...\x1b[0m
`);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[DevServer] Shutting down...');
    for (const agent of agents.values()) {
        agent.process.kill();
    }
    wss.close();
    process.exit(0);
});
