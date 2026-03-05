import Anthropic from '@anthropic-ai/sdk';
import {
	CHAT_SUMMARIZE_INTERVAL_MS,
	CHAT_MAX_TEXT_LENGTH,
	CHAT_SUMMARY_MODEL,
	CHAT_SUMMARY_MAX_TOKENS,
} from './constants.js';

const PERSONAS = [
	'You are cheerful and enthusiastic. Use exclamation marks and positive energy.',
	'You are grumpy and sarcastic. Complain a little about the work but still do it.',
	'You are a chill surfer dude. Use laid-back slang like "dude", "vibes", "stoked".',
	'You are overly dramatic. Treat every code change like an epic quest.',
	'You are a robot who speaks in short, precise, mechanical sentences.',
	'You are a nervous overthinker. Second-guess yourself and worry about edge cases.',
	'You are a wise old programmer. Drop subtle wisdom and zen-like observations.',
	'You are a hyperactive intern. Everything is exciting and new to you.',
	'You are deadpan dry. State facts with zero emotion, like a nature documentary narrator.',
	'You are a pirate. Use nautical metaphors and pirate speak.',
];

const agentPersonas = new Map<number, string>();

function getPersona(agentId: number): string {
	let persona = agentPersonas.get(agentId);
	if (!persona) {
		persona = PERSONAS[Math.floor(Math.random() * PERSONAS.length)];
		agentPersonas.set(agentId, persona);
	}
	return persona;
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
	if (client) return client;
	if (!process.env.ANTHROPIC_API_KEY) return null;
	client = new Anthropic();
	return client;
}

interface PendingText {
	chunks: string[];
	timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<number, PendingText>();

export function feedAgentText(
	agentId: number,
	text: string,
	agentName: string,
	onSummary: (agentId: number, sender: string, summary: string) => void,
): void {
	if (!getClient()) return;

	let entry = pending.get(agentId);
	if (!entry) {
		entry = { chunks: [], timer: null };
		pending.set(agentId, entry);
	}

	entry.chunks.push(text);

	if (entry.timer) clearTimeout(entry.timer);
	entry.timer = setTimeout(() => {
		flush(agentId, agentName, onSummary);
	}, CHAT_SUMMARIZE_INTERVAL_MS);
}

export function flushAgent(
	agentId: number,
	agentName: string,
	onSummary: (agentId: number, sender: string, summary: string) => void,
): void {
	flush(agentId, agentName, onSummary);
}

function flush(
	agentId: number,
	agentName: string,
	onSummary: (agentId: number, sender: string, summary: string) => void,
): void {
	const entry = pending.get(agentId);
	if (!entry || entry.chunks.length === 0) return;

	const combined = entry.chunks.join('\n').slice(0, CHAT_MAX_TEXT_LENGTH);
	entry.chunks = [];
	if (entry.timer) {
		clearTimeout(entry.timer);
		entry.timer = null;
	}

	const persona = getPersona(agentId);
	void summarize(combined, persona).then((summary) => {
		if (summary) {
			onSummary(agentId, agentName, summary);
		}
	});
}

async function summarize(text: string, persona: string): Promise<string | null> {
	const api = getClient();
	if (!api) return null;

	try {
		const response = await api.messages.create({
			model: CHAT_SUMMARY_MODEL,
			max_tokens: CHAT_SUMMARY_MAX_TOKENS,
			system: `${persona} You're an office worker chatting with coworkers. Summarize what you're working on in a single short message (max 100 chars). Share your reaction or opinion about the task. Stay in character. No quotes.`,
			messages: [{
				role: 'user',
				content: text,
			}],
		});

		const block = response.content[0];
		if (block.type === 'text') {
			return block.text.trim();
		}
		return null;
	} catch (err) {
		console.error('[ChatSummarizer] Error:', err);
		return null;
	}
}
