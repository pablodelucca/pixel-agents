import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ── Load .env file (no external deps) ───────────────────────
function loadEnvFile(): void {
    // Walk up from cwd looking for .env
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
        const envPath = path.join(dir, '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf-8');
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) {continue;}
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx === -1) {continue;}
                const key = trimmed.slice(0, eqIdx).trim();
                const value = trimmed.slice(eqIdx + 1).trim();
                if (!process.env[key]) {
                    process.env[key] = value;
                }
            }
            break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {break;}
        dir = parent;
    }
}

// ── Parse CLI arguments (with .env / env var fallbacks) ─────
function parseArgs(): {
    sessionId: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    projectDir: string;
} {
    loadEnvFile();
    const args = process.argv.slice(2);
    const get = (flag: string): string => {
        const idx = args.indexOf(flag);
        if (idx === -1 || idx + 1 >= args.length) {
            return '';
        }
        return args[idx + 1];
    };
    return {
        sessionId: get('--session-id') || crypto.randomUUID(),
        baseUrl: get('--base-url') || process.env.PIXEL_AGENTS_BASE_URL || 'http://localhost:1234/v1',
        apiKey: get('--api-key') || process.env.PIXEL_AGENTS_API_KEY || 'lmstudio',
        model: get('--model') || process.env.PIXEL_AGENTS_MODEL || 'local-model',
        projectDir: get('--project-dir') || process.env.PIXEL_AGENTS_PROJECT_DIR || '',
    };
}

// ── JSONL Writer ────────────────────────────────────────────
class TranscriptWriter {
    private filePath: string;

    constructor(projectDir: string, sessionId: string) {
        // Ensure the project dir exists
        fs.mkdirSync(projectDir, { recursive: true });
        this.filePath = path.join(projectDir, `${sessionId}.jsonl`);
        // Create the file so the extension can detect it
        fs.writeFileSync(this.filePath, '');
        console.log(`\x1b[2m📝 Transcript: ${this.filePath}\x1b[0m`);
    }

    write(record: Record<string, unknown>): void {
        fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n');
    }

    writeUserMessage(content: string): void {
        this.write({
            type: 'user',
            message: { role: 'user', content },
        });
    }

    writeAssistantText(text: string): void {
        this.write({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'text', text }],
            },
        });
    }

    writeTurnEnd(): void {
        this.write({
            type: 'system',
            subtype: 'turn_duration',
        });
    }
}

// ── Main ────────────────────────────────────────────────────
async function main(): Promise<void> {
    const config = parseArgs();

    if (!config.projectDir) {
        console.error('Error: --project-dir is required');
        process.exit(1);
    }

    const client = new OpenAI({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
    });

    const transcript = new TranscriptWriter(config.projectDir, config.sessionId);
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        {
            role: 'system',
            content: 'You are a helpful coding assistant. Be concise and direct.',
        },
    ];

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log(`\x1b[36m╔══════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m  \x1b[1mPixel Agents Local Chat\x1b[0m                 \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m  Model: \x1b[33m${config.model.padEnd(32)}\x1b[0m \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m║\x1b[0m  Server: \x1b[33m${config.baseUrl.padEnd(31)}\x1b[0m \x1b[36m║\x1b[0m`);
    console.log(`\x1b[36m╚══════════════════════════════════════════╝\x1b[0m`);
    console.log(`\x1b[2mType your message and press Enter. Ctrl+C to exit.\x1b[0m\n`);

    const prompt = (): void => {
        rl.question('\x1b[32m❯\x1b[0m ', async (input: string) => {
            const trimmed = input.trim();
            if (!trimmed) {
                prompt();
                return;
            }

            // Write user message to transcript
            messages.push({ role: 'user', content: trimmed });
            transcript.writeUserMessage(trimmed);

            try {
                // Call LM Studio via OpenAI API
                const response = await client.chat.completions.create({
                    model: config.model,
                    messages,
                    stream: false,
                });

                const assistantMessage = response.choices[0]?.message?.content || '(no response)';

                // Write assistant response to transcript
                messages.push({ role: 'assistant', content: assistantMessage });
                transcript.writeAssistantText(assistantMessage);
                transcript.writeTurnEnd();

                // Display the response
                console.log(`\n\x1b[36m${assistantMessage}\x1b[0m\n`);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error(`\n\x1b[31mError: ${errorMessage}\x1b[0m\n`);
                // Still write turn end so the character goes back to waiting
                transcript.writeTurnEnd();
            }

            prompt();
        });
    };

    // Handle clean exit
    rl.on('close', () => {
        console.log('\n\x1b[2mSession ended.\x1b[0m');
        process.exit(0);
    });

    prompt();
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
