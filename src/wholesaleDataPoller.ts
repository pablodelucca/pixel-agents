import * as path from 'path';

import type {
  DbSnapshot,
  DealCounts,
  DripStages,
  LeadCounts,
  OutreachStats,
  SendWindowStatus,
} from './types.js';

// ── Send Window Constants (Central Time) ─────────────────────
const DEFAULT_WINDOWS: Record<number, [number, number] | null> = {
  0: [10, 12], // Monday
  1: [10, 14], // Tuesday
  2: [10, 14], // Wednesday
  3: [10, 14], // Thursday
  4: [10, 12], // Friday
  5: null, // Saturday
  6: null, // Sunday
};

const QUIET_HOURS_START = 21; // 9pm CT
const QUIET_HOURS_END = 8; // 8am CT

/** Poll interval in ms */
export const DB_POLL_INTERVAL_MS = 5000;

// We use dynamic import for better-sqlite3 so it fails gracefully
// if the native module isn't available
type BetterSqlite3Database = {
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
  close(): void;
};

let Database:
  | (new (path: string, options?: Record<string, unknown>) => BetterSqlite3Database)
  | null = null;

async function loadSqliteModule(): Promise<boolean> {
  try {
    const mod = require('better-sqlite3');
    Database = mod as typeof Database;
    return true;
  } catch {
    console.warn('[WholesaleDataPoller] better-sqlite3 not available, trying sql.js fallback');
    return false;
  }
}

let db: BetterSqlite3Database | null = null;

function getDb(wholesaleDir: string): BetterSqlite3Database | null {
  if (db) return db;
  if (!Database) return null;
  const dbPath = path.join(wholesaleDir, 'wholesale.db');
  try {
    db = new Database!(dbPath, { readonly: true, fileMustExist: true });
    // Enable WAL mode busy timeout
    (db as unknown as { pragma(s: string): void }).pragma?.('busy_timeout = 1000');
    return db;
  } catch (err) {
    console.error('[WholesaleDataPoller] Failed to open DB:', err);
    return null;
  }
}

function queryLeadCounts(database: BetterSqlite3Database): LeadCounts {
  const counts: LeadCounts = {
    total: 0,
    new: 0,
    dripping: 0,
    dripComplete: 0,
    responded: 0,
    doNotContact: 0,
    badNumber: 0,
    hot: 0,
    paused: 0,
  };
  try {
    const rows = database
      .prepare('SELECT status, COUNT(*) as cnt FROM leads GROUP BY status')
      .all();
    for (const row of rows) {
      const status = row.status as string;
      const cnt = row.cnt as number;
      counts.total += cnt;
      switch (status) {
        case 'new':
          counts.new = cnt;
          break;
        case 'dripping':
          counts.dripping = cnt;
          break;
        case 'drip_complete':
          counts.dripComplete = cnt;
          break;
        case 'responded':
          counts.responded = cnt;
          break;
        case 'do_not_contact':
          counts.doNotContact = cnt;
          break;
        case 'bad_number':
          counts.badNumber = cnt;
          break;
        case 'hot':
          counts.hot = cnt;
          break;
        case 'paused':
          counts.paused = cnt;
          break;
      }
    }
  } catch (err) {
    console.error('[WholesaleDataPoller] queryLeadCounts error:', err);
  }
  return counts;
}

function queryDripStages(database: BetterSqlite3Database): DripStages {
  const stages: DripStages = {};
  try {
    const rows = database
      .prepare(
        "SELECT drip_stage, COUNT(*) as cnt FROM leads WHERE status='dripping' GROUP BY drip_stage",
      )
      .all();
    for (const row of rows) {
      stages[row.drip_stage as number] = row.cnt as number;
    }
  } catch (err) {
    console.error('[WholesaleDataPoller] queryDripStages error:', err);
  }
  return stages;
}

function queryOutreachStats(database: BetterSqlite3Database): OutreachStats {
  const stats: OutreachStats = { sentToday: 0, totalSent: 0, totalReplied: 0, replyRate: 0 };
  try {
    const todayRow = database
      .prepare("SELECT COUNT(*) as cnt FROM outreach_log WHERE sent_at >= date('now')")
      .get();
    stats.sentToday = (todayRow?.cnt as number) || 0;

    const totalRow = database.prepare('SELECT COUNT(*) as cnt FROM outreach_log').get();
    stats.totalSent = (totalRow?.cnt as number) || 0;

    const repliedRow = database
      .prepare('SELECT COUNT(*) as cnt FROM outreach_log WHERE replied=1')
      .get();
    stats.totalReplied = (repliedRow?.cnt as number) || 0;

    stats.replyRate = stats.totalSent > 0 ? (stats.totalReplied / stats.totalSent) * 100 : 0;
  } catch (err) {
    console.error('[WholesaleDataPoller] queryOutreachStats error:', err);
  }
  return stats;
}

function queryDealCounts(database: BetterSqlite3Database): DealCounts {
  const counts: DealCounts = {
    total: 0,
    qualifying: 0,
    waitingArv: 0,
    waitingRepairs: 0,
    offered: 0,
    negotiating: 0,
    underContract: 0,
    closed: 0,
    passed: 0,
  };
  try {
    const rows = database
      .prepare('SELECT status, COUNT(*) as cnt FROM deals GROUP BY status')
      .all();
    for (const row of rows) {
      const status = row.status as string;
      const cnt = row.cnt as number;
      counts.total += cnt;
      switch (status) {
        case 'qualifying':
          counts.qualifying = cnt;
          break;
        case 'waiting_arv':
          counts.waitingArv = cnt;
          break;
        case 'waiting_repairs':
          counts.waitingRepairs = cnt;
          break;
        case 'offered':
          counts.offered = cnt;
          break;
        case 'negotiating':
          counts.negotiating = cnt;
          break;
        case 'under_contract':
          counts.underContract = cnt;
          break;
        case 'closed':
          counts.closed = cnt;
          break;
        case 'passed':
          counts.passed = cnt;
          break;
      }
    }
  } catch (err) {
    console.error('[WholesaleDataPoller] queryDealCounts error:', err);
  }
  return counts;
}

function computeSendWindow(): SendWindowStatus {
  // Get current time in Central Time
  const now = new Date();
  const ctString = now.toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const ct = new Date(ctString);
  const day = ct.getDay(); // 0=Sun, adjust to 0=Mon
  const dayOfWeek = day === 0 ? 6 : day - 1; // Mon=0 ... Sun=6
  const hour = ct.getHours();

  // Check quiet hours
  if (hour >= QUIET_HOURS_START || hour < QUIET_HOURS_END) {
    return { isOpen: false, nextOpen: computeNextWindow(dayOfWeek, hour) };
  }

  const window = DEFAULT_WINDOWS[dayOfWeek];
  if (!window) {
    return { isOpen: false, nextOpen: computeNextWindow(dayOfWeek, hour) };
  }

  const [start, end] = window;
  if (hour >= start && hour < end) {
    return { isOpen: true, nextOpen: null };
  }

  return { isOpen: false, nextOpen: computeNextWindow(dayOfWeek, hour) };
}

function computeNextWindow(currentDay: number, currentHour: number): string | null {
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // Check rest of today first
  const todayWindow = DEFAULT_WINDOWS[currentDay];
  if (todayWindow && currentHour < todayWindow[0]) {
    return `${dayNames[currentDay]} ${todayWindow[0]}:00 AM CT`;
  }
  // Check following days
  for (let offset = 1; offset <= 7; offset++) {
    const day = (currentDay + offset) % 7;
    const window = DEFAULT_WINDOWS[day];
    if (window) {
      const hourStr = window[0] > 12 ? `${window[0] - 12}:00 PM` : `${window[0]}:00 AM`;
      return `${dayNames[day]} ${hourStr} CT`;
    }
  }
  return null;
}

export function createEmptyDbSnapshot(): DbSnapshot {
  return {
    leads: {
      total: 0,
      new: 0,
      dripping: 0,
      dripComplete: 0,
      responded: 0,
      doNotContact: 0,
      badNumber: 0,
      hot: 0,
      paused: 0,
    },
    dripStages: {},
    outreach: { sentToday: 0, totalSent: 0, totalReplied: 0, replyRate: 0 },
    deals: {
      total: 0,
      qualifying: 0,
      waitingArv: 0,
      waitingRepairs: 0,
      offered: 0,
      negotiating: 0,
      underContract: 0,
      closed: 0,
      passed: 0,
    },
    sendWindow: { isOpen: false, nextOpen: null },
  };
}

export async function initDataPoller(): Promise<boolean> {
  return loadSqliteModule();
}

export function pollDatabase(wholesaleDir: string): DbSnapshot {
  const database = getDb(wholesaleDir);
  if (!database) {
    return createEmptyDbSnapshot();
  }

  return {
    leads: queryLeadCounts(database),
    dripStages: queryDripStages(database),
    outreach: queryOutreachStats(database),
    deals: queryDealCounts(database),
    sendWindow: computeSendWindow(),
  };
}

export function disposeDataPoller(): void {
  if (db) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    db = null;
  }
}
