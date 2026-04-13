import { useState } from 'react';

import type { Server } from '../types/database.js';

interface ServerPasswordModalProps {
  isOpen: boolean;
  server: Server | null;
  onClose: () => void;
  onSuccess: () => void;
}

// API base URL
const API_BASE_URL = '';

export function ServerPasswordModal({ isOpen, server, onClose, onSuccess }: ServerPasswordModalProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  if (!isOpen || !server) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/servers/${server.id}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update password');
      }

      // Clear form and close
      setPassword('');
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setPassword('');
    setError(null);
    onClose();
  };

  return (
    <>
      {/* Dark backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.6)',
          zIndex: 99,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 100,
          background: 'var(--pixel-bg)',
          border: '2px solid var(--pixel-border)',
          borderRadius: 0,
          padding: '4px',
          boxShadow: 'var(--pixel-shadow)',
          minWidth: 360,
          maxWidth: '90vw',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--pixel-border)',
          }}
        >
          <span style={{ fontSize: '24px', color: 'var(--pixel-text)' }}>
            🔐 SSH Password
          </span>
          <button
            onClick={handleClose}
            onMouseEnter={() => setHovered('close')}
            onMouseLeave={() => setHovered(null)}
            style={{
              background: hovered === 'close' ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
              border: 'none',
              borderRadius: 0,
              color: 'var(--pixel-text-dim)',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Server Info */}
        <div
          style={{
            padding: '12px 12px 8px',
            borderBottom: '1px solid var(--pixel-border)',
          }}
        >
          <div style={{ fontSize: '22px', color: 'var(--pixel-text)', marginBottom: 4 }}>
            {server.name}
          </div>
          <div style={{ fontSize: '18px', color: 'var(--pixel-text-dim)' }}>
            {server.public_ip || 'No IP'} • {server.ssh_user || 'root'}@{server.ssh_port || 22}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '16px 12px' }}>
          <div style={{ marginBottom: 12 }}>
            <label
              style={{
                display: 'block',
                fontSize: '20px',
                color: 'var(--pixel-text)',
                marginBottom: 6,
              }}
            >
              Password
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter SSH password"
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: '20px',
                  color: 'var(--pixel-text)',
                  background: 'var(--pixel-input-bg, rgba(0, 0, 0, 0.3))',
                  border: '2px solid var(--pixel-border)',
                  borderRadius: 0,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  padding: '8px 12px',
                  fontSize: '20px',
                  background: 'var(--pixel-btn-bg)',
                  border: '2px solid var(--pixel-border)',
                  borderRadius: 0,
                  cursor: 'pointer',
                  color: 'var(--pixel-text)',
                }}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && (
            <div
              style={{
                padding: '8px 10px',
                marginBottom: 12,
                fontSize: '18px',
                color: '#ff6b6b',
                background: 'rgba(255, 107, 107, 0.1)',
                border: '1px solid rgba(255, 107, 107, 0.3)',
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              padding: '8px 10px',
              marginBottom: 12,
              fontSize: '16px',
              color: 'var(--pixel-text-dim)',
              background: 'rgba(90, 140, 255, 0.1)',
              border: '1px solid rgba(90, 140, 255, 0.2)',
            }}
          >
            ⚠️ Password will be encrypted before saving. This is for testing purposes only.
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={isLoading}
              style={{
                padding: '8px 16px',
                fontSize: '20px',
                color: 'var(--pixel-text)',
                background: 'transparent',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                cursor: isLoading ? 'wait' : 'pointer',
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !password.trim()}
              onMouseEnter={() => setHovered('save')}
              onMouseLeave={() => setHovered(null)}
              style={{
                padding: '8px 20px',
                fontSize: '20px',
                color: '#fff',
                background: isLoading
                  ? 'var(--pixel-accent)'
                  : hovered === 'save'
                    ? 'rgba(90, 140, 255, 0.9)'
                    : 'var(--pixel-accent)',
                border: '2px solid var(--pixel-accent)',
                borderRadius: 0,
                cursor: isLoading ? 'wait' : 'pointer',
                opacity: !password.trim() ? 0.5 : 1,
              }}
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
