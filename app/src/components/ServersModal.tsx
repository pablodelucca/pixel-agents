import { useState } from 'react';

interface ServersModalProps {
  isOpen: boolean;
  onClose?: () => void;
}

interface ServerPackage {
  id: string;
  name: string;
  emoji: string;
  size: string;
  employees: number;
  cpu: number;
  ram: number;
  storage: number;
}

const SERVER_PACKAGES: ServerPackage[] = [
  {
    id: 'starter',
    name: 'Starter',
    emoji: '🏠',
    size: '25 sqm',
    employees: 5,
    cpu: 2,
    ram: 2,
    storage: 40,
  },
  {
    id: 'business',
    name: 'Business',
    emoji: '🏢',
    size: '100 sqm',
    employees: 10,
    cpu: 2,
    ram: 4,
    storage: 60,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    emoji: '🏛️',
    size: '400 sqm',
    employees: 20,
    cpu: 2,
    ram: 8,
    storage: 80,
  },
];

export function ServersModal({ isOpen, onClose }: ServersModalProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<string>('business'); // Default to Business

  if (!isOpen) return null;

  const handleLater = () => {
    if (onClose) {
      onClose();
    }
  };

  const handlePurchase = () => {
    const pkg = SERVER_PACKAGES.find((p) => p.id === selectedPackage);
    if (pkg) {
      alert(`Purchasing ${pkg.name} package:\n${pkg.size} • ${pkg.employees} employees\n${pkg.cpu} vCPU • ${pkg.ram}GB RAM • ${pkg.storage}GB Storage`);
      // TODO: Implement actual purchase flow
    }
  };

  return (
    <>
      {/* Dark backdrop - click to close if onClose is provided */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 49,
          cursor: onClose ? 'pointer' : 'default',
        }}
      />
      {/* Centered dialog */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 50,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 420,
          maxWidth: '90vw',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 10px',
            borderBottom: '1px solid var(--pixel-border)',
            marginBottom: '12px',
          }}
        >
          <span style={{ fontSize: '26px', color: '#4ECDC4', fontWeight: 'bold' }}>
            🏢 Welcome to Clawmpany!
          </span>
        </div>

        {/* Content */}
        <div style={{ padding: '16px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🖥️</div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: 'var(--pixel-text)',
              marginBottom: '12px',
            }}
          >
            No Active Office
          </div>
          <div
            style={{
              fontSize: '20px',
              color: 'rgba(255, 255, 255, 0.7)',
              lineHeight: 1.5,
              marginBottom: '8px',
            }}
          >
            You don't have an active office yet.
          </div>
          <div
            style={{
              fontSize: '18px',
              color: 'rgba(255, 255, 255, 0.5)',
              lineHeight: 1.4,
              marginBottom: '16px',
            }}
          >
            Choose a server package to get started!
          </div>

          {/* Server packages */}
          <div
            style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              marginBottom: '20px',
            }}
          >
            {SERVER_PACKAGES.map((pkg) => {
              const isSelected = selectedPackage === pkg.id;
              const isHovered = hovered === pkg.id;

              return (
                <div
                  key={pkg.id}
                  onClick={() => setSelectedPackage(pkg.id)}
                  onMouseEnter={() => setHovered(pkg.id)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    background: isSelected
                      ? 'rgba(78, 205, 196, 0.15)'
                      : isHovered
                        ? 'rgba(255, 255, 255, 0.08)'
                        : 'rgba(255, 255, 255, 0.03)',
                    border: isSelected
                      ? '2px solid #4ECDC4'
                      : isHovered
                        ? '1px solid rgba(78, 205, 196, 0.5)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: 4,
                    padding: '12px 14px',
                    textAlign: 'center',
                    minWidth: 110,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    transform: isHovered && !isSelected ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div style={{ fontSize: '24px', marginBottom: '4px' }}>{pkg.emoji}</div>
                  <div
                    style={{
                      fontSize: '14px',
                      color: isSelected ? '#4ECDC4' : 'rgba(255, 255, 255, 0.7)',
                      fontWeight: 'bold',
                    }}
                  >
                    {pkg.name}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'rgba(255, 255, 255, 0.5)',
                      marginTop: 4,
                    }}
                  >
                    {pkg.size} • {pkg.employees} emp
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: 'rgba(255, 255, 255, 0.4)',
                      marginTop: 2,
                    }}
                  >
                    {pkg.cpu} vCPU • {pkg.ram}GB • {pkg.storage}GB
                  </div>
                  {isSelected && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#4ECDC4',
                        marginTop: 6,
                        fontWeight: 'bold',
                      }}
                    >
                      ✓ Selected
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: 'center',
            padding: '12px 8px 16px',
          }}
        >
          {onClose && (
            <button
              onClick={handleLater}
              onMouseEnter={() => setHovered('later')}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '10px 24px',
                fontSize: '20px',
                color: 'rgba(255, 255, 255, 0.6)',
                background: hovered === 'later' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 0,
                cursor: 'pointer',
              }}
            >
              Later
            </button>
          )}
          <button
            onClick={handlePurchase}
            onMouseEnter={() => setHovered('purchase')}
            onMouseLeave={() => setHovered(null)}
            style={{
              padding: '10px 28px',
              fontSize: '20px',
              color: '#fff',
              background: hovered === 'purchase' ? 'rgba(78, 205, 196, 0.4)' : '#4ECDC4',
              border: '2px solid #4ECDC4',
              borderRadius: 0,
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            Purchase Server
          </button>
        </div>
      </div>
    </>
  );
}
