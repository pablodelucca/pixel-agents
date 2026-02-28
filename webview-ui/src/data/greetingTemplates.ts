import type { TownNpc } from './townNpcs.js'

export type GreetingTier = 'first_meeting' | 'return_recent' | 'return_long' | 'familiar'

export interface ConstructMemory {
  construct: string
  last_interaction_date: string | null
  interaction_count: number
  last_topic: string | null
  mood: string | null
  interactions: { date: string; greeting_used: string; dialogue_shown: string }[]
}

function daysSince(isoDate: string): number {
  const then = new Date(isoDate).getTime()
  const now = Date.now()
  return Math.floor((now - then) / (1000 * 60 * 60 * 24))
}

/**
 * Select a greeting tier and compose the dialogue text.
 *
 * Each NPC keeps their unique voice line (npc.greeting).
 * The wrapper text changes based on visit count and recency.
 */
export function selectGreeting(
  memory: ConstructMemory,
  npc: TownNpc,
): { tier: GreetingTier; text: string; visitCount: number } {
  const count = memory.interaction_count

  if (count === 0) {
    return { tier: 'first_meeting', text: npc.greeting, visitCount: 0 }
  }

  const days = memory.last_interaction_date ? daysSince(memory.last_interaction_date) : 999

  if (count >= 5) {
    return {
      tier: 'familiar',
      text: `Visit #${count + 1}. ${npc.greeting}`,
      visitCount: count,
    }
  }

  if (days >= 7) {
    return {
      tier: 'return_long',
      text: `It's been a while... ${days} days. ${npc.greeting}`,
      visitCount: count,
    }
  }

  return {
    tier: 'return_recent',
    text: `Welcome back, Magistrate. ${npc.greeting}`,
    visitCount: count,
  }
}
