import { useCallback, useEffect, useState } from 'react';

import { toMajorMinor } from '../changelogData.ts';
import { WHATS_NEW_AUTO_CLOSE_MS, WHATS_NEW_FADE_MS } from '../constants.ts';

interface VersionIndicatorProps {
  currentVersion: string;
  lastSeenVersion: string;
  onDismiss: () => void;
  onOpenChangelog: () => void;
}

export function VersionIndicator({
  currentVersion,
  lastSeenVersion,
  onDismiss,
  onOpenChangelog,
}: VersionIndicatorProps) {
  const [dismissed, setDismissed] = useState(false);
  const [fading, setFading] = useState(false);
  const [labelHovered, setLabelHovered] = useState(false);

  const currentMajorMinor = toMajorMinor(currentVersion);
  const isUnseen = currentMajorMinor !== lastSeenVersion;
  const showUpdateNotice = isUnseen && !dismissed;

  // Start fade-out after auto-close delay, then fully dismiss after the transition
  useEffect(() => {
    if (!showUpdateNotice || fading) return;
    const fadeTimer = setTimeout(() => setFading(true), WHATS_NEW_AUTO_CLOSE_MS);
    return () => clearTimeout(fadeTimer);
  }, [showUpdateNotice, fading]);

  useEffect(() => {
    if (!fading) return;
    const removeTimer = setTimeout(() => {
      setDismissed(true);
      onDismiss();
    }, WHATS_NEW_FADE_MS);
    return () => clearTimeout(removeTimer);
  }, [fading, onDismiss]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setDismissed(true);
      onDismiss();
    },
    [onDismiss],
  );

  const handleOpenChangelog = useCallback(() => {
    setDismissed(true);
    onOpenChangelog();
  }, [onOpenChangelog]);

  if (!currentVersion) return null;

  return (
    <>
      {/* Update notice — shown once per version until dismissed or auto-closed */}
      {showUpdateNotice && (
        <div
          onClick={handleOpenChangelog}
          style={{
            position: 'absolute',
            bottom: 28,
            right: 28,
            zIndex: 45,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '8px 10px 9px',
            boxShadow: 'var(--pixel-shadow)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxWidth: 260,
            opacity: fading ? 0 : 1,
            transition: `opacity ${WHATS_NEW_FADE_MS / 1000}s ease-out`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-end',
              gap: 10,
            }}
          >
            <span style={{ fontSize: '24px', color: 'var(--pixel-accent)', lineHeight: 0.5 }}>
              Updated to v{currentMajorMinor}!
            </span>
            <button
              onClick={handleDismiss}
              style={{
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                color: 'rgba(255, 255, 255, 0.5)',
                fontSize: '22px',
                cursor: 'pointer',
                padding: '0 2px',
                lineHeight: 0.8,
                marginLeft: 4,
                flexShrink: 0,
              }}
            >
              x
            </button>
          </div>
          <span
            style={{
              fontSize: '20px',
              color: 'var(--pixel-text-dim)',
              whiteSpace: 'nowrap',
            }}
          >
            See what's new
          </span>
        </div>
      )}
      {/* Hover tooltip — "See what's new" appears on label hover after notice is gone */}
      {!showUpdateNotice && labelHovered && (
        <div
          onClick={handleOpenChangelog}
          style={{
            position: 'absolute',
            bottom: 28,
            right: 28,
            zIndex: 45,
            background: 'var(--pixel-bg)',
            border: '2px solid var(--pixel-border)',
            borderRadius: 0,
            padding: '6px 12px',
            boxShadow: 'var(--pixel-shadow)',
            cursor: 'pointer',
            fontSize: '20px',
            color: 'var(--pixel-text-dim)',
            whiteSpace: 'nowrap',
          }}
        >
          See what's new!
        </div>
      )}
      {/* Version label — always visible */}
      <div
        onMouseEnter={() => setLabelHovered(true)}
        onMouseLeave={() => setLabelHovered(false)}
        onClick={handleOpenChangelog}
        style={{
          position: 'absolute',
          bottom: 8,
          right: 28,
          zIndex: 45,
          fontSize: '24px',
          color: 'var(--pixel-text-dim)',
          opacity: labelHovered ? 0.8 : 0.4,
          cursor: 'pointer',
          transition: 'opacity 0.2s',
          userSelect: 'none',
          paddingRight: 2,
        }}
      >
        v{currentMajorMinor}
      </div>
    </>
  );
}
