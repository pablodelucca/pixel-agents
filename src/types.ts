// ── Wholesale Agent Types ──────────────────────────────────────

/** The three fixed wholesale agents */
export const WHOLESALE_AGENTS = {
  LEAD_SCOUT: {
    id: 1,
    name: 'Lead Scout',
    script: 'lead_scout.py',
    palette: 0,
    logFile: 'lead_scout.log',
  },
  OUTREACH_ENGINE: {
    id: 2,
    name: 'Outreach Engine',
    script: 'outreach_engine.py',
    palette: 2,
    logFile: 'outreach_engine.log',
  },
  DEAL_CLOSER: {
    id: 3,
    name: 'Deal Closer',
    script: 'deal_closer.py',
    palette: 4,
    logFile: 'deal_closer.log',
  },
} as const;

export type WholesaleAgentId = 1 | 2 | 3;

export interface WholesaleAgentDef {
  id: WholesaleAgentId;
  name: string;
  script: string;
  palette: number;
  logFile: string;
}

/** Process status from pgrep */
export type ProcessStatus = 'running' | 'not_running';

/** Character animation state in the webview */
export type AgentAnimState = 'TYPING' | 'IDLE' | 'ABSENT';

/** A speech bubble to show above a character */
export interface AgentBubble {
  text: string;
  type: 'info' | 'alert' | 'sleeping' | 'offline';
}

/** Lead counts from the DB */
export interface LeadCounts {
  total: number;
  new: number;
  dripping: number;
  dripComplete: number;
  responded: number;
  doNotContact: number;
  badNumber: number;
  hot: number;
  paused: number;
}

/** Drip stage distribution */
export interface DripStages {
  [stage: number]: number;
}

/** Outreach stats from the DB */
export interface OutreachStats {
  sentToday: number;
  totalSent: number;
  totalReplied: number;
  replyRate: number;
}

/** Deal counts from the DB */
export interface DealCounts {
  total: number;
  qualifying: number;
  waitingArv: number;
  waitingRepairs: number;
  offered: number;
  negotiating: number;
  underContract: number;
  closed: number;
  passed: number;
}

/** Send window status */
export interface SendWindowStatus {
  isOpen: boolean;
  nextOpen: string | null; // e.g. "Mon 10:00 AM CT"
}

/** Full DB snapshot */
export interface DbSnapshot {
  leads: LeadCounts;
  dripStages: DripStages;
  outreach: OutreachStats;
  deals: DealCounts;
  sendWindow: SendWindowStatus;
}

/** Trigger event from .triggers/ directory */
export interface TriggerEvent {
  name: string;
  payload: Record<string, unknown>;
  timestamp: number; // Date.now() when detected
}

/** Log event parsed from agent logs */
export interface LogEvent {
  agent: string;
  timestamp: string; // HH:MM:SS
  message: string;
  rawLine: string;
  parsedAt: number; // Date.now()
}

/** Per-agent state computed by the state mapper */
export interface AgentCharacterState {
  id: WholesaleAgentId;
  name: string;
  processStatus: ProcessStatus;
  animState: AgentAnimState;
  bubble: AgentBubble | null;
  lastActivity: string | null; // human-readable
}

/** Complete snapshot sent to the webview */
export interface WholesaleStateSnapshot {
  agents: AgentCharacterState[];
  db: DbSnapshot;
  lastUpdate: number; // Date.now()
}
