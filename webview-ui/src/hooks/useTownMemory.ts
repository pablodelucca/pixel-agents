import { useCallback } from 'react'
import { TOWN_NPCS } from '../data/townNpcs.js'
import { selectGreeting, type ConstructMemory, type GreetingTier } from '../data/greetingTemplates.js'

export interface GreetingResult {
  tier: GreetingTier
  text: string
  visitCount: number
}

function createEmptyMemory(construct: string): ConstructMemory {
  return {
    construct,
    last_interaction_date: null,
    interaction_count: 0,
    last_topic: null,
    mood: null,
    interactions: [],
  }
}

/**
 * Hook for fetching NPC memory and logging interactions.
 * Talks to the Express server's /api/memory endpoints.
 */
export function useTownMemory(): {
  getGreeting: (npcId: number) => Promise<GreetingResult>
  logInteraction: (npcId: number, tier: string, text: string) => void
} {
  const getGreeting = useCallback(async (npcId: number): Promise<GreetingResult> => {
    const npc = TOWN_NPCS[npcId - 1]
    if (!npc) {
      return { tier: 'first_meeting', text: '...', visitCount: 0 }
    }

    let memory: ConstructMemory
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(npc.constructName)}`)
      memory = res.ok ? await res.json() : createEmptyMemory(npc.constructName)
    } catch {
      // Server not running — fall back to first-meeting greeting
      memory = createEmptyMemory(npc.constructName)
    }

    return selectGreeting(memory, npc)
  }, [])

  const logInteraction = useCallback((npcId: number, tier: string, text: string) => {
    const npc = TOWN_NPCS[npcId - 1]
    if (!npc) return

    // Fire-and-forget — don't block UI on logging
    fetch(`/api/memory/${encodeURIComponent(npc.constructName)}/interact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        greeting_used: tier,
        dialogue_shown: text,
      }),
    }).catch(() => {
      // Server not running — silently skip logging
    })
  }, [])

  return { getGreeting, logInteraction }
}
