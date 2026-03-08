import { useState } from 'react';

import type { AgentCharacterState, DbSnapshot } from '../hooks/useExtensionMessages.js';

interface StatusOverlayProps {
  dbSnapshot: DbSnapshot | null;
  agentStates: Record<number, AgentCharacterState>;
}

export function StatusOverlay({ dbSnapshot, agentStates }: StatusOverlayProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!dbSnapshot) return null;

  const { leads, outreach, deals, sendWindow } = dbSnapshot;

  // Count active (online) agents
  const agentList = Object.values(agentStates);
  const onlineCount = agentList.filter((a) => a.processStatus === 'running').length;

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 50,
        background: 'rgba(10, 10, 20, 0.85)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: collapsed ? '4px 8px' : '8px 12px',
        boxShadow: 'var(--pixel-shadow)',
        color: '#cdd6f4',
        fontSize: '20px',
        lineHeight: 1.6,
        minWidth: collapsed ? 'auto' : 240,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          marginBottom: collapsed ? 0 : 4,
        }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span style={{ fontWeight: 'bold', letterSpacing: '2px', color: '#89b4fa' }}>PIPELINE</span>
        <span style={{ fontSize: '16px', color: '#6c7086', marginLeft: 8 }}>
          {collapsed ? '+' : '-'}
        </span>
      </div>

      {!collapsed && (
        <>
          <div style={{ borderTop: '1px solid #313244', marginBottom: 6 }} />

          {/* Agents status */}
          <div style={{ marginBottom: 6 }}>
            <span style={{ color: '#a6adc8', fontSize: '18px' }}>
              Agents: {onlineCount}/3 online
            </span>
          </div>

          {/* Leads */}
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#94e2d5' }}>Leads:</span> <span>{leads.dripping} dripping</span>
            {leads.new > 0 && <span> | {leads.new} new</span>}
            {leads.responded > 0 && <span> | {leads.responded} responded</span>}
            {leads.hot > 0 && <span style={{ color: '#f38ba8' }}> | {leads.hot} hot</span>}
          </div>

          {/* Outreach */}
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: '#89b4fa' }}>Outreach:</span>{' '}
            <span>{outreach.sentToday} sent today</span>
            <span> | {outreach.replyRate.toFixed(1)}% reply</span>
            <span>
              {' '}
              | Window:{' '}
              <span style={{ color: sendWindow.isOpen ? '#a6e3a1' : '#f38ba8' }}>
                {sendWindow.isOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </span>
          </div>

          {/* Deals */}
          <div>
            <span style={{ color: '#f9e2af' }}>Deals:</span>{' '}
            <span>
              {deals.qualifying +
                deals.waitingArv +
                deals.waitingRepairs +
                deals.offered +
                deals.negotiating +
                deals.underContract}{' '}
              active
            </span>
            {deals.offered > 0 && <span> | {deals.offered} offers</span>}
            {deals.closed > 0 && <span style={{ color: '#a6e3a1' }}> | {deals.closed} closed</span>}
          </div>
        </>
      )}
    </div>
  );
}
