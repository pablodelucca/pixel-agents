import type {
  MissionControlAgentSession,
  MissionControlTask,
  MissionControlTokenUsage,
} from '../../../shared/missionControl.ts';

export function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

export function formatTimestamp(value: string | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(value: string | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) return value;
  const diffSeconds = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatDuration(startedAt: string | undefined, endedAt?: string): string {
  if (!startedAt) return 'Unknown';
  const start = new Date(startedAt);
  const end = new Date(endedAt ?? Date.now());
  const diffMs = end.getTime() - start.getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return 'Unknown';

  const totalSeconds = Math.floor(diffMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${totalHours}h ${minutes}m` : `${totalHours}h`;
}

export function formatTokenCount(value: number | undefined): string {
  if (value === undefined) return 'Unavailable';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return value.toLocaleString();
}

export function formatTokenUsageSummary(usage: MissionControlTokenUsage | undefined): string {
  if (!usage) return 'Unavailable from current hook payload';
  const total =
    usage.totalTokens ??
    (usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? usage.inputTokens + usage.outputTokens
      : undefined);
  if (total === undefined) return 'Unavailable from current hook payload';
  return `${formatTokenCount(total)} total`;
}

export function formatTokenUsageDetails(usage: MissionControlTokenUsage | undefined): string[] {
  if (!usage) return ['Total: unavailable'];

  return [
    `Total: ${formatTokenCount(
      usage.totalTokens ??
        (usage.inputTokens !== undefined && usage.outputTokens !== undefined
          ? usage.inputTokens + usage.outputTokens
          : undefined),
    )}`,
    `Input: ${formatTokenCount(usage.inputTokens)}`,
    `Output: ${formatTokenCount(usage.outputTokens)}`,
    `Cached input: ${formatTokenCount(usage.cachedInputTokens)}`,
    `Reasoning: ${formatTokenCount(usage.reasoningTokens)}`,
  ];
}

export function getSessionTaskLabel(
  session: MissionControlAgentSession,
  task: MissionControlTask | undefined,
): string {
  if (task?.title) return task.title;
  if (session.lastActionSummary) return session.lastActionSummary;
  if (session.currentTool) return `Using ${session.currentTool}`;
  return 'No assigned task';
}

export function getSessionProgressLabel(
  session: MissionControlAgentSession,
  task: MissionControlTask | undefined,
): string {
  if (session.status === 'waiting_approval') {
    return session.blockerReason ?? 'Waiting for approval';
  }
  if (session.status === 'waiting_input') {
    return session.blockerReason ?? session.lastActionSummary ?? 'Waiting for input';
  }
  if (session.status === 'blocked') {
    return session.blockerReason ?? task?.latestUpdate ?? 'Blocked';
  }
  if (session.currentTool && session.lastActionSummary) {
    return `${session.currentTool}: ${session.lastActionSummary}`;
  }
  if (task?.latestUpdate) return task.latestUpdate;
  if (session.lastActionSummary) return session.lastActionSummary;
  if (session.currentTool) return `Using ${session.currentTool}`;
  return humanize(session.status);
}

export function getTaskTone(status: string): string {
  if (status === 'done') return 'text-status-success border-status-success/50';
  if (status === 'blocked' || status === 'failed' || status === 'cancelled') {
    return 'text-status-error border-status-error/50';
  }
  if (status === 'review') return 'text-status-permission border-status-permission/50';
  return 'text-status-active border-status-active/50';
}

export function getApprovalTone(riskType: string): string {
  if (riskType === 'high') return 'text-status-error border-status-error/50';
  if (riskType === 'medium') return 'text-status-permission border-status-permission/50';
  return 'text-status-active border-status-active/50';
}

export function getSessionTone(status: string): string {
  if (status === 'completed') return 'text-status-success border-status-success/50';
  if (status === 'waiting_approval') return 'text-status-permission border-status-permission/50';
  if (status === 'blocked' || status === 'failed' || status === 'stopped') {
    return 'text-status-error border-status-error/50';
  }
  return 'text-status-active border-status-active/50';
}
