// Module-level store for max tokens setting (same pattern as notificationSound.ts)

const DEFAULT_MAX_TOKENS = 512

let maxTokens = DEFAULT_MAX_TOKENS

export function setMaxTokens(value: number): void {
  maxTokens = value
}

export function getMaxTokens(): number {
  return maxTokens
}
