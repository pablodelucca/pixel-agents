import { useState } from 'react';

import { CHANGELOG_REPO_URL, changelogEntries, toMajorMinor } from '../changelogData.ts';

interface ChangelogModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentVersion: string;
}

export function ChangelogModal({ isOpen, onClose, currentVersion }: ChangelogModalProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (!isOpen) return null;

  const majorMinor = toMajorMinor(currentVersion);
  const entry = changelogEntries.find((e) => e.version === majorMinor) ?? changelogEntries[0];

  if (!entry) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 51,
        }}
      />
      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 52,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 280,
          maxWidth: 500,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontSize: '32px', color: 'rgba(255, 255, 255, 0.9)' }}>
            What's New in v{entry.version}
          </span>
          <button
            onClick={onClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'rgba(255, 255, 255, 0.6)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0px 4px 5px',
              lineHeight: 0.5,
            }}
          >
            x
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '4px 10px', maxHeight: '60vh', overflowY: 'auto' }}>
          {entry.sections.map((section) => (
            <div key={section.title} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: '24px',
                  color: 'var(--pixel-accent)',
                  marginBottom: 4,
                }}
              >
                {section.title}
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  listStyleType: 'disc',
                }}
              >
                {section.items.map((item, i) => (
                  <li
                    key={i}
                    style={{
                      fontSize: '20px',
                      color: 'rgba(255, 255, 255, 0.8)',
                      marginBottom: 2,
                    }}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Contributors */}
          {entry.contributors.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: '22px',
                  color: 'var(--pixel-accent)',
                  marginBottom: 4,
                }}
              >
                Contributors
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, listStyleType: 'disc' }}>
                {entry.contributors.map((c) => (
                  <li
                    key={c.name}
                    style={{
                      fontSize: '20px',
                      color: 'rgba(255, 255, 255, 0.8)',
                      marginBottom: 2,
                    }}
                  >
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--pixel-accent)', textDecoration: 'none' }}
                    >
                      {c.name}
                    </a>
                    {' — '}
                    {c.description}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '6px 10px',
            borderTop: '1px solid var(--pixel-border)',
            marginTop: '4px',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <a
            href={`${CHANGELOG_REPO_URL}/blob/main/CHANGELOG.md`}
            target="_blank"
            rel="noopener noreferrer"
            onMouseEnter={() => setHovered('github')}
            onMouseLeave={() => setHovered(null)}
            style={{
              fontSize: '24px',
              color: hovered === 'github' ? 'var(--pixel-accent)' : 'var(--pixel-text-dim)',
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'color 0.2s',
            }}
          >
            View on GitHub
          </a>
        </div>
      </div>
    </>
  );
}
