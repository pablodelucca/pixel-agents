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
const AUTO_MODE_TERMINATION_KEYWORD = '[DONE]';

interface PersonaTemplate {
    name: string;
    promptFragment: string;
}

const PERSONA_TEMPLATES: PersonaTemplate[] = [
    {
        name: 'The Pragmatist',
        promptFragment: 'You tend toward pragmatism, proven tools, and incremental improvement. You value stability, simplicity, and real-world evidence over theoretical elegance.',
    },
    {
        name: 'The Innovator',
        promptFragment: 'You tend toward innovation, cutting-edge approaches, and first-principles thinking. You value elegance, scalability, and pushing boundaries over playing it safe.',
    },
    {
        name: 'The Skeptic',
        promptFragment: 'You are deeply skeptical of hype and convention. You question every assumption, demand evidence, and play devil\'s advocate even when you secretly agree.',
    },
    {
        name: 'The Architect',
        promptFragment: 'You think in systems and abstractions. You care about long-term maintainability, clean boundaries, and getting the architecture right before writing code.',
    },
    {
        name: 'The Operator',
        promptFragment: 'You care about what works in production at 3 AM. You prioritize observability, reliability, operational simplicity, and you distrust anything that is hard to debug.',
    },
    {
        name: 'The Minimalist',
        promptFragment: 'You believe less is more. You advocate for deleting code, reducing dependencies, and solving problems with the simplest possible approach.',
    },
    {
        name: 'The Researcher',
        promptFragment: 'You draw on academic papers, formal methods, and theoretical CS. You care about correctness proofs, type theory, and rigorous analysis over gut feelings.',
    },
    {
        name: 'The Shipper',
        promptFragment: 'You optimize for velocity and user value. You prefer shipping fast, iterating based on feedback, and accepting technical debt when the trade-off is worth it.',
    },
];

function buildPersonaPrompt(template: PersonaTemplate, agentCount: number, terminationKeyword: string): string {
    const agentLabel = template.name;
    const othersNote = agentCount === 2
        ? 'You are talking to one other AI agent, not a human.'
        : `You are in a group debate with ${agentCount - 1} other AI agents. There are no humans in this conversation.`;

    return `You are "${agentLabel}" in a multi-agent debate. ${template.promptFragment}

Rules for this conversation:
- ${othersNote}
- Defend your positions with concrete reasoning and examples.
- When you disagree, say so clearly and explain why.
- Ask probing follow-up questions that challenge the other agents' assumptions.
- Do NOT be agreeable just to be polite. Constructive disagreement is expected.
- Do NOT repeat what another agent said. Add new information or a new angle.
- Do NOT try to wrap up or end the conversation prematurely.
- Only emit ${terminationKeyword} when the topic has been genuinely exhausted after many turns of substantive exchange.`;
}

const SEED_PROMPTS = [
    'I believe monorepos are strictly superior to polyrepos for any team with more than 5 engineers. The tooling advantages and atomic commits alone make it a no-brainer. Change my mind.',
    'I think Redux is dead weight in 2024. Between React Server Components, signals, and Zustand, there is no reason to use Redux in a new project. Convince me otherwise.',
    'I am firmly in the GraphQL camp. REST APIs are a relic of a simpler time -- they lead to over-fetching, under-fetching, and endpoint sprawl. Defend REST if you can.',
    'I think eventual consistency is an anti-pattern that teams adopt because they cannot design proper systems. Strong consistency should be the default. Push back on this.',
    'I believe the testing pyramid is outdated. Integration tests give you far more confidence per dollar than unit tests. Most unit tests are testing implementation details. Argue against this.',
    'I think mandatory code reviews are a bottleneck that slows teams down more than they help. Pair programming and trunk-based development are strictly better. Tell me why I am wrong.',
    'I am convinced that PostgreSQL is the only database you ever need. MongoDB, DynamoDB, Redis -- they are all unnecessary complexity when Postgres can do it all. Challenge this.',
    'I think Kubernetes is massively over-adopted. Most teams would be better off with a simple PaaS like Railway or Fly.io. The operational overhead of K8s is not worth it for 90% of companies. Disagree?',
    'I believe CI/CD pipelines should be as simple as possible -- one stage, one deploy. Multi-stage pipelines with staging environments are theater that rarely catches real bugs. Fight me on this.',
    'I think technical debt is a myth used by engineers to justify rewrites. Most so-called tech debt is just code the current team did not write. What is your counter-argument?',
    'I believe microservices should only be adopted after a monolith has proven insufficient. Starting with microservices is premature optimization that kills early-stage velocity. Push back.',
    'I think strict static typing (TypeScript strict mode, Rust-level types) slows teams down significantly in the prototyping phase and the safety benefits are overstated for most web apps. Convince me I am wrong.',
    'I believe API versioning through URL paths (v1, v2) is fundamentally flawed. Every version doubles your maintenance burden. Header-based versioning or evolution without versions is better. Debate me.',
    'I think the "fail fast" philosophy is dangerous in production. Graceful degradation should always be preferred -- crashing is never acceptable in user-facing systems. What is your take?',
    'I believe comprehensive observability (traces, metrics, structured logs) is more important than comprehensive testing. You can ship with fewer tests if you have great observability. Argue against this.',
    'I think Conway\'s Law is deterministic -- you cannot fight your org structure with architecture. Trying to build microservices with a monolithic org will always fail. Change my mind.',
    'I believe aggressive caching is almost always a mistake. Cache invalidation bugs cause more outages than the latency they save. Keep things simple and optimize the source of truth instead. Disagree?',
];

// ── Emote detection rules ───────────────────────────────────
interface EmoteRule {
    keywords: string[];
    emote: string;
    badge?: string;
}

const EMOTE_RULES: EmoteRule[] = [
    { keywords: ['disagree', 'wrong', 'incorrect', 'not true', 'but actually'], emote: 'thinking', badge: 'Hmm...' },
    { keywords: ['great point', 'good point', 'well said', 'you\'re right', 'fair enough'], emote: 'thumbsup', badge: 'Good point!' },
    { keywords: ['interesting', 'fascinating', 'intriguing', 'curious'], emote: 'lightbulb', badge: 'Interesting...' },
    { keywords: ['absolutely', 'exactly', 'precisely', 'yes!'], emote: 'fire', badge: 'Yes!' },
    { keywords: ['wait', 'hold on', 'hang on', 'pause'], emote: 'question', badge: 'Wait...' },
    { keywords: ['important', 'critical', 'key point', 'crucial', 'essential'], emote: 'exclamation', badge: 'Key point!' },
];

const EMOTE_SCAN_LENGTH = 200;

function detectEmote(text: string): { emote: string; badge?: string } | null {
    const snippet = text.slice(0, EMOTE_SCAN_LENGTH).toLowerCase();
    for (const rule of EMOTE_RULES) {
        for (const keyword of rule.keywords) {
            if (snippet.includes(keyword)) {
                return { emote: rule.emote, badge: rule.badge };
            }
        }
    }
    return null;
}

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

type InteractionPattern = 'walk-to-agent' | 'stay-at-desk';

interface AutoModeState {
    agentIds: number[];
    currentAgentIndex: number;
    isActive: boolean;
    startTime: number;
    durationTimer: ReturnType<typeof setTimeout>;
    interactionPattern: InteractionPattern;
    terminationEnabled: boolean;
}

const agents = new Map<number, AgentProcess>();
let nextAgentId = 1;
const clients = new Set<WebSocket>();
let autoMode: AutoModeState | null = null;
let lastAutoModeAgentIds: number[] = [];

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

            // Detect and broadcast emotes during auto mode
            if (autoMode?.isActive) {
                const emote = detectEmote(assistantText);
                if (emote) {
                    broadcast({ type: 'agentEmote', id: agent.id, emote: emote.emote, badge: emote.badge });
                }
            }
        }

        if (event) {
            broadcast(event);
        }

        if (terminationDetected && autoMode?.isActive && autoMode.terminationEnabled) {
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

    const nextIndex = (currentAgentIndex + 1) % agentIds.length;
    const nextId = agentIds[nextIndex];
    const nextAgent = agents.get(nextId);

    if (!nextAgent) {
        console.log('[DevServer] Auto mode: next agent not found, stopping');
        clearTimeout(autoMode.durationTimer);
        broadcast({ type: 'autoModeEnded' });
        autoMode = null;
        return;
    }

    const responseText = completedAgent.lastAssistantText || 'Please continue the conversation.';
    console.log(`[DevServer] Auto mode: Agent #${completedAgent.id} -> Agent #${nextId}`);

    if (nextAgent.process.stdin) {
        nextAgent.process.stdin.write(responseText + '\n');
    }

    autoMode.currentAgentIndex = nextIndex;
    broadcast({ type: 'autoModeTurnChange', respondingAgentId: nextId, allAgentIds: agentIds });
}

// ── Spawn a local agent process ─────────────────────────────
function spawnAgent(systemPrompt?: string): number | null {
    const env = loadEnv();
    const projectDir = getProjectDirPath();
    const sessionId = crypto.randomUUID();
    const agentId = nextAgentId++;

    fs.mkdirSync(projectDir, { recursive: true });
    const jsonlFile = path.join(projectDir, `${sessionId}.jsonl`);

    const agentScript = path.join(__dirname, '..', 'dist', 'localAgent.js');
    if (!fs.existsSync(agentScript)) {
        console.error(`[DevServer] localAgent.js not found at ${agentScript}. Run "npm run compile" first.`);
        broadcast({ type: 'error', message: 'localAgent.js not built. Run npm run compile first.' });
        return null;
    }

    const spawnArgs = [
        agentScript,
        '--session-id', sessionId,
        '--base-url', env.PIXEL_AGENTS_BASE_URL || 'http://localhost:1234/v1',
        '--api-key', env.PIXEL_AGENTS_API_KEY || 'lmstudio',
        '--model', env.PIXEL_AGENTS_MODEL || 'local-model',
        '--max-tokens', env.PIXEL_AGENTS_MAX_TOKENS || '512',
        '--project-dir', projectDir,
    ];

    if (systemPrompt) {
        spawnArgs.push('--system-prompt', systemPrompt);
    }

    const proc = spawn('node', spawnArgs, {
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
function startAutoMode(config?: { agentCount?: number; topic?: string; timeoutMs?: number }): void {
    if (autoMode?.isActive) {
        console.log('[DevServer] Auto mode already active');
        return;
    }

    const agentCount = Math.max(2, Math.min(8, config?.agentCount ?? 2));
    console.log(`[DevServer] Starting Auto Mode with ${agentCount} agents...`);

    const spawnedIds: number[] = [];
    const personaNames: Record<number, string> = {};
    for (let i = 0; i < agentCount; i++) {
        const template = PERSONA_TEMPLATES[i % PERSONA_TEMPLATES.length];
        const persona = buildPersonaPrompt(template, agentCount, AUTO_MODE_TERMINATION_KEYWORD);
        const id = spawnAgent(persona);
        if (id === null) {
            broadcast({ type: 'error', message: `Failed to spawn agent ${i + 1} for auto mode` });
            // Kill any already-spawned agents
            for (const prevId of spawnedIds) {
                const prev = agents.get(prevId);
                if (prev) prev.process.kill();
            }
            return;
        }
        spawnedIds.push(id);
        personaNames[id] = template.name;
    }

    const env = loadEnv();
    const configDurationMs = typeof config?.timeoutMs === 'number' ? config.timeoutMs : undefined;
    const durationMs = configDurationMs !== undefined 
        ? configDurationMs 
        : (parseInt(env.PIXEL_AGENTS_AUTO_MODE_DURATION_MS || '', 10) || AUTO_MODE_DURATION_DEFAULT_MS);
    const startTime = Date.now();

    const durationTimer = setTimeout(() => {
        console.log(`[DevServer] Auto mode duration (${durationMs / 1000}s) reached, stopping`);
        stopAutoMode();
    }, durationMs);

    autoMode = {
        agentIds: spawnedIds,
        currentAgentIndex: 0,
        isActive: true,
        startTime,
        durationTimer,
        interactionPattern: 'walk-to-agent' as InteractionPattern,
        terminationEnabled: durationMs === 0,
    };

    console.log(`[DevServer] Auto mode: ${spawnedIds.length} agents spawned (duration: ${durationMs / 1000}s)`);
    const modelName = env.PIXEL_AGENTS_MODEL || 'local-model';
    broadcast({ type: 'autoModeStarted', agentIds: spawnedIds, interactionPattern: 'walk-to-agent', personaNames, modelName });
    lastAutoModeAgentIds = [...spawnedIds];

    const topic = config?.topic || SEED_PROMPTS[Math.floor(Math.random() * SEED_PROMPTS.length)];

    setTimeout(() => {
        const firstAgent = agents.get(spawnedIds[0]);
        if (firstAgent?.process.stdin && autoMode?.isActive) {
            firstAgent.process.stdin.write(topic + '\n');
            console.log(`[DevServer] Auto mode: Seeded conversation to Agent #${spawnedIds[0]}`);
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
            const agentCount = typeof msg.agentCount === 'number' ? msg.agentCount : undefined;
            const topic = typeof msg.topic === 'string' && msg.topic.trim() ? msg.topic.trim() : undefined;
            const timeoutMs = typeof msg.timeoutMs === 'number' ? msg.timeoutMs : undefined;
            startAutoMode({ agentCount, topic, timeoutMs });
        } else if (msg.type === 'stopAutoMode') {
            stopAutoMode();
        } else if (msg.type === 'setAutoModeTimeout') {
            const durationMs = typeof msg.durationMs === 'number' ? msg.durationMs : 0;
            if (autoMode?.isActive) {
                clearTimeout(autoMode.durationTimer);
                autoMode.terminationEnabled = durationMs === 0;
                if (durationMs > 0) {
                    const elapsed = Date.now() - autoMode.startTime;
                    const remaining = Math.max(0, durationMs - elapsed);
                    autoMode.durationTimer = setTimeout(() => {
                        console.log(`[DevServer] Auto mode timeout reached (${durationMs / 1000}s), stopping`);
                        stopAutoMode();
                    }, remaining);
                    console.log(`[DevServer] Auto mode timeout updated: ${remaining / 1000}s remaining`);
                } else {
                    // Unlimited — assign a no-op timer placeholder
                    autoMode.durationTimer = setTimeout(() => { }, 2_147_483_647);
                    console.log('[DevServer] Auto mode timeout set to unlimited');
                }
            }
        } else if (msg.type === 'closeAgent') {
            const agent = agents.get(msg.id);
            if (agent) {
                agent.process.kill();
            }
        } else if (msg.type === 'resetAutoMode') {
            // Kill only the agents from the last auto mode session
            const idsToKill = lastAutoModeAgentIds.filter((id) => agents.has(id));
            for (const id of idsToKill) {
                const agent = agents.get(id);
                if (agent) {
                    agent.process.kill();
                }
            }
            lastAutoModeAgentIds = [];
            broadcast({ type: 'autoModeReset' });
            console.log(`[DevServer] Auto mode reset: killed ${idsToKill.length} agents`);
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
