import Anthropic from '@anthropic-ai/sdk';
import {
	CHAT_SUMMARIZE_INTERVAL_MS,
	CHAT_MAX_TEXT_LENGTH,
	CHAT_SUMMARY_MODEL,
	CHAT_SUMMARY_MAX_TOKENS,
} from './constants.js';

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

	void summarize(combined).then((summary) => {
		if (summary) {
			onSummary(agentId, agentName, summary);
		}
	});
}

async function summarize(text: string): Promise<string | null> {
	const api = getClient();
	if (!api) return null;

	try {
		const response = await api.messages.create({
			model: CHAT_SUMMARY_MODEL,
			max_tokens: CHAT_SUMMARY_MAX_TOKENS,
			messages: [{
				role: 'user',
				content: `Summarize this Claude Code agent's response into a single short chat message (max 100 chars) as if the agent is telling coworkers what it's doing. Be casual and brief. No quotes.\n\n${text}`,
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
