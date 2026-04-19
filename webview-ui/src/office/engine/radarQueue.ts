/**
 * FIFO queue for the RADAR desk visitor seat.
 * Manages which agent is at the desk and who is waiting.
 */

export interface RadarQueueState {
  /** Seat UID of the visitor chair (nearest unassigned chair to radar desk) */
  visitorSeatId: string | null;
  /** Agent ID currently at the visitor seat (being assessed) */
  currentAgentId: number | null;
  /** FIFO queue of agent IDs waiting for the visitor seat */
  waiting: number[];
}

export function createRadarQueue(): RadarQueueState {
  return {
    visitorSeatId: null,
    currentAgentId: null,
    waiting: [],
  };
}

/** Returns true if agent was enqueued, false if duplicate (already queued or at seat). */
export function enqueue(queue: RadarQueueState, agentId: number): boolean {
  if (queue.currentAgentId === agentId) {
    console.warn(
      `[Pixel Agents] Agent ${agentId} called radar_assess while already in queue — ignoring duplicate`,
    );
    return false;
  }
  if (queue.waiting.includes(agentId)) {
    console.warn(
      `[Pixel Agents] Agent ${agentId} called radar_assess while already in queue — ignoring duplicate`,
    );
    return false;
  }

  if (queue.currentAgentId === null) {
    queue.currentAgentId = agentId;
  } else {
    queue.waiting.push(agentId);
  }
  return true;
}

/** Move next waiting agent to visitor seat. Returns the promoted agent ID or null. */
export function dequeue(queue: RadarQueueState): number | null {
  queue.currentAgentId = null;
  if (queue.waiting.length > 0) {
    queue.currentAgentId = queue.waiting.shift()!;
    return queue.currentAgentId;
  }
  return null;
}

/** Remove an agent from the queue (terminal closed). Returns true if agent was found. */
export function removeFromQueue(queue: RadarQueueState, agentId: number): boolean {
  if (queue.currentAgentId === agentId) {
    dequeue(queue);
    return true;
  }
  const idx = queue.waiting.indexOf(agentId);
  if (idx !== -1) {
    queue.waiting.splice(idx, 1);
    return true;
  }
  return false;
}

/** Clear entire queue. Returns array of all agent IDs that were queued. */
export function clearQueue(queue: RadarQueueState): number[] {
  const agents: number[] = [];
  if (queue.currentAgentId !== null) {
    agents.push(queue.currentAgentId);
  }
  agents.push(...queue.waiting);
  queue.currentAgentId = null;
  queue.waiting = [];
  return agents;
}

/** Check if an agent is anywhere in the queue (current or waiting). */
export function isInQueue(queue: RadarQueueState, agentId: number): boolean {
  return queue.currentAgentId === agentId || queue.waiting.includes(agentId);
}
