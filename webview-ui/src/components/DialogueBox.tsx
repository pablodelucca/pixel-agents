import type { TownNpc } from '../data/townNpcs.js'

interface DialogueBoxProps {
  npc: TownNpc
  /** Dynamic greeting from memory system. Falls back to npc.greeting if undefined. */
  greeting?: string
  /** Number of previous visits (0 = first meeting). */
  visitCount?: number
}

/**
 * Dialogue overlay shown when the player interacts with an NPC.
 * Fixed position at bottom-center, pixel-art aesthetic.
 */
export function DialogueBox({ npc, greeting, visitCount = 0 }: DialogueBoxProps) {
  const displayText = greeting ?? npc.greeting

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 32,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 45,
        background: 'rgba(20, 20, 35, 0.95)',
        border: '2px solid #555',
        padding: '16px 24px',
        maxWidth: '480px',
        minWidth: '320px',
        fontFamily: 'monospace',
        color: '#ddd',
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: '14px', color: '#8af', fontWeight: 'bold' }}>
          {npc.constructName}
        </div>
        <div style={{ fontSize: '10px', color: '#666' }}>
          {visitCount === 0 ? 'First meeting' : `Visit #${visitCount + 1}`}
        </div>
      </div>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: 8 }}>
        {npc.role}
      </div>
      <div style={{ fontSize: '13px', lineHeight: 1.6, color: '#ccc' }}>
        &ldquo;{displayText}&rdquo;
      </div>
      <div style={{ fontSize: '10px', color: '#555', marginTop: 12, textAlign: 'right' }}>
        ESC to close
      </div>
    </div>
  )
}
