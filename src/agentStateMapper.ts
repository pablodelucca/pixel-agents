import type { LogTailerState } from './logTailer.js';
import { getLatestMessage, hasRecentActivity, LOG_ACTIVE_MS } from './logTailer.js';
import type { ProcessStatusMap } from './processDetector.js';
import type { TriggerWatcherState } from './triggerWatcher.js';
import { getRecentTriggers, getTargetAgentId, TRIGGER_RECENT_MS } from './triggerWatcher.js';
import type {
  AgentBubble,
  AgentCharacterState,
  DbSnapshot,
  WholesaleAgentId,
  WholesaleStateSnapshot,
} from './types.js';
import { WHOLESALE_AGENTS } from './types.js';

/** Mapping from agent names in logs to our agent IDs */
const LOG_AGENT_NAME_MAP: Record<string, WholesaleAgentId> = {
  leadscout: 1,
  lead_scout: 1,
  outreachengine: 2,
  outreach_engine: 2,
  dealcloser: 3,
  deal_closer: 3,
};

function getLogAgentName(agentId: WholesaleAgentId): string {
  switch (agentId) {
    case 1:
      return 'LeadScout';
    case 2:
      return 'OutreachEngine';
    case 3:
      return 'DealCloser';
  }
}

/** Map trigger events to speech bubble text */
function triggerToBubble(triggerName: string, agentId: WholesaleAgentId): AgentBubble | null {
  switch (triggerName) {
    case 'leads_scored':
      return agentId === 2 ? { text: 'New leads!', type: 'alert' } : null;
    case 'send_due':
      return agentId === 2 ? { text: 'Sending...', type: 'info' } : null;
    case 'deal_created':
      return agentId === 3 ? { text: 'Deal alert!', type: 'alert' } : null;
    case 'lead_responded':
      return agentId === 3 ? { text: 'Response!', type: 'alert' } : null;
    case 'deal_under_contract':
      return agentId === 3 ? { text: 'Contract!', type: 'alert' } : null;
    case 'scrape_complete':
      return agentId === 1 ? { text: 'Processing...', type: 'info' } : null;
    default:
      return null;
  }
}

/** Derive bubble from log messages */
function logMessageToBubble(message: string, agentId: WholesaleAgentId): AgentBubble | null {
  const lower = message.toLowerCase();

  if (agentId === 1) {
    if (lower.includes('inbox') && lower.includes('imported'))
      return { text: 'New leads!', type: 'alert' };
    if (lower.includes('scrape') || lower.includes('scraping'))
      return { text: 'Scraping...', type: 'info' };
    if (lower.includes('enroll')) return { text: 'Enrolling...', type: 'info' };
    if (lower.includes('heartbeat starting')) return { text: 'Checking...', type: 'info' };
  }

  if (agentId === 2) {
    if (lower.includes('outside send window')) return { text: 'Window closed', type: 'sleeping' };
    if (lower.includes('daily') && lower.includes('report'))
      return { text: 'Reporting', type: 'info' };
    if (lower.includes('sent today') || lower.includes('outreach:'))
      return { text: 'Sending...', type: 'info' };
    if (lower.includes('heartbeat starting')) return { text: 'Checking...', type: 'info' };
  }

  if (agentId === 3) {
    if (lower.includes('deal') && lower.includes('approval'))
      return { text: 'Reviewing...', type: 'info' };
    if (lower.includes('buyer') && lower.includes('match'))
      return { text: 'Matching!', type: 'alert' };
    if (lower.includes('closing') && lower.includes('deadline'))
      return { text: 'Deadline!', type: 'alert' };
    if (lower.includes('heartbeat starting')) return { text: 'Checking...', type: 'info' };
  }

  if (lower.includes('heartbeat complete')) return null; // heartbeat ended, go idle
  return null;
}

export function computeAgentStates(
  processStatuses: ProcessStatusMap,
  dbSnapshot: DbSnapshot,
  triggerState: TriggerWatcherState,
  logState: LogTailerState,
): WholesaleStateSnapshot {
  const agents: AgentCharacterState[] = [];

  for (const agentDef of Object.values(WHOLESALE_AGENTS)) {
    const id = agentDef.id as WholesaleAgentId;
    const processStatus = processStatuses[id];
    const logAgentName = getLogAgentName(id);

    // Priority 1: Process not running → ABSENT
    if (processStatus === 'not_running') {
      agents.push({
        id,
        name: agentDef.name,
        processStatus: 'not_running',
        animState: 'ABSENT',
        bubble: { text: 'Offline', type: 'offline' },
        lastActivity: null,
      });
      continue;
    }

    // Priority 2: Active log line within LOG_ACTIVE_MS → TYPING
    if (hasRecentActivity(logState, logAgentName, LOG_ACTIVE_MS)) {
      const latestMsg = getLatestMessage(logState, logAgentName);
      const logBubble = latestMsg ? logMessageToBubble(latestMsg, id) : null;

      // Check if Outreach is outside send window (from log)
      if (id === 2 && latestMsg && latestMsg.toLowerCase().includes('outside send window')) {
        agents.push({
          id,
          name: agentDef.name,
          processStatus: 'running',
          animState: 'IDLE',
          bubble: { text: 'Sleeping', type: 'sleeping' },
          lastActivity: latestMsg,
        });
        continue;
      }

      agents.push({
        id,
        name: agentDef.name,
        processStatus: 'running',
        animState: 'TYPING',
        bubble: logBubble,
        lastActivity: latestMsg,
      });
      continue;
    }

    // Priority 3: Recent trigger within TRIGGER_RECENT_MS → TYPING
    const recentTriggers = getRecentTriggers(triggerState);
    const triggerForAgent = recentTriggers.find((t) => {
      const targetId = getTargetAgentId(t.name);
      return targetId === id && Date.now() - t.timestamp < TRIGGER_RECENT_MS;
    });
    if (triggerForAgent) {
      const bubble = triggerToBubble(triggerForAgent.name, id);
      agents.push({
        id,
        name: agentDef.name,
        processStatus: 'running',
        animState: 'TYPING',
        bubble,
        lastActivity: `Trigger: ${triggerForAgent.name}`,
      });
      continue;
    }

    // Priority 4: Heartbeat complete, idle → IDLE (wander)
    // Priority 5: Outside send window (Outreach only) → IDLE + sleeping
    if (id === 2 && !dbSnapshot.sendWindow.isOpen) {
      agents.push({
        id,
        name: agentDef.name,
        processStatus: 'running',
        animState: 'IDLE',
        bubble: { text: 'Sleeping', type: 'sleeping' },
        lastActivity: dbSnapshot.sendWindow.nextOpen
          ? `Next: ${dbSnapshot.sendWindow.nextOpen}`
          : null,
      });
      continue;
    }

    // Default: running but idle
    agents.push({
      id,
      name: agentDef.name,
      processStatus: 'running',
      animState: 'IDLE',
      bubble: null,
      lastActivity: null,
    });
  }

  return {
    agents,
    db: dbSnapshot,
    lastUpdate: Date.now(),
  };
}
