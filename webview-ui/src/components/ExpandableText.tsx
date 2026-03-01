import { useState } from 'react'
import { PANEL_FONT } from './panelStyles.js'

interface ExpandableTextProps {
  text: string
  previewLength: number
  style?: React.CSSProperties
}

export function ExpandableText({ text, previewLength, style }: ExpandableTextProps) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = text.length > previewLength

  return (
    <div style={style}>
      <span>{expanded || !needsTruncation ? text : text.slice(0, previewLength) + '...'}</span>
      {needsTruncation && (
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: 'inline',
            marginLeft: 4,
            padding: '0 2px',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            color: 'rgba(90, 140, 255, 0.85)',
            fontSize: 'inherit',
            fontFamily: PANEL_FONT,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
