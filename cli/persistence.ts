/**
 * CLI Persistence — Simple JSON file storage for ~/.pixel-agents/
 *
 * Handles seats.json and settings.json with atomic write (same pattern as layoutPersistence.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PERSISTENCE_DIR = path.join(os.homedir(), '.pixel-agents');
const SEATS_FILE = path.join(PERSISTENCE_DIR, 'seats.json');
const SETTINGS_FILE = path.join(PERSISTENCE_DIR, 'settings.json');

function ensureDir(): void {
	if (!fs.existsSync(PERSISTENCE_DIR)) {
		fs.mkdirSync(PERSISTENCE_DIR, { recursive: true });
	}
}

function atomicWrite(filePath: string, data: unknown): void {
	ensureDir();
	const json = JSON.stringify(data, null, 2);
	const tmpPath = filePath + '.tmp';
	fs.writeFileSync(tmpPath, json, 'utf-8');
	fs.renameSync(tmpPath, filePath);
}

function readJson<T>(filePath: string, fallback: T): T {
	try {
		if (!fs.existsSync(filePath)) return fallback;
		const raw = fs.readFileSync(filePath, 'utf-8');
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

// ── Seats ────────────────────────────────────────────────────

export function readSeats(): Record<string, unknown> {
	return readJson<Record<string, unknown>>(SEATS_FILE, {});
}

export function writeSeats(seats: Record<string, unknown>): void {
	atomicWrite(SEATS_FILE, seats);
}

// ── Settings ─────────────────────────────────────────────────

interface CliSettings {
	soundEnabled: boolean;
}

export function readSettings(): CliSettings {
	return readJson<CliSettings>(SETTINGS_FILE, { soundEnabled: true });
}

export function writeSettings(settings: CliSettings): void {
	atomicWrite(SETTINGS_FILE, settings);
}
