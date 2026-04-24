import {
  FUEL_COLOR_CRITICAL,
  FUEL_COLOR_DANGER,
  FUEL_COLOR_OK,
  FUEL_COLOR_WARN,
  MAX_CONTEXT_TOKENS,
  TOKEN_CRITICAL_THRESHOLD,
  TOKEN_DANGER_THRESHOLD,
  TOKEN_WARN_THRESHOLD,
} from '../constants.js';

interface AgentTokens {
  input: number;
  output: number;
}

interface TokenCounterProps {
  agentTokens: Record<number, AgentTokens>;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TokenCounter({ agentTokens }: TokenCounterProps) {
  const entries = Object.values(agentTokens);
  if (entries.length === 0) return null;

  let totalInput = 0;
  let totalOutput = 0;
  let maxInput = 0;

  for (const { input, output } of entries) {
    totalInput += input;
    totalOutput += output;
    if (input > maxInput) maxInput = input;
  }

  const ratio = maxInput / MAX_CONTEXT_TOKENS;
  const color =
    ratio >= TOKEN_CRITICAL_THRESHOLD
      ? FUEL_COLOR_CRITICAL
      : ratio >= TOKEN_DANGER_THRESHOLD
        ? FUEL_COLOR_DANGER
        : ratio >= TOKEN_WARN_THRESHOLD
          ? FUEL_COLOR_WARN
          : FUEL_COLOR_OK;

  return (
    <div className="absolute top-8 right-8 z-10 pixel-panel px-10 py-6 select-none pointer-events-none">
      <div className="flex flex-col gap-2 text-2xs tabular-nums" style={{ color }}>
        <div className="flex gap-6 justify-between">
          <span className="text-text-muted">in</span>
          <span>{fmt(totalInput)}</span>
        </div>
        <div className="flex gap-6 justify-between">
          <span className="text-text-muted">out</span>
          <span>{fmt(totalOutput)}</span>
        </div>
      </div>
    </div>
  );
}
