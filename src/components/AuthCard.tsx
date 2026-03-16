import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.js';

export function AuthCard() {
  const { signIn, signUp, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSignUpSuccess(false);

    if (!email || !password) {
      setLocalError('Please fill in all fields');
      return;
    }

    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters');
      return;
    }

    if (isSignUp) {
      if (!fullName) {
        setLocalError('Please enter your full name');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match');
        return;
      }
      await signUp(email, password, fullName);
      if (!error) {
        setSignUpSuccess(true);
      }
    } else {
      await signIn(email, password);
    }
  };

  const displayError = localError || error;

  return (
    <>
      {/* Dark overlay over office background */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 1000,
        }}
      />

      {/* Auth Card */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--pixel-bg, #1e1e1e)',
          border: '4px solid var(--pixel-border, #3c3c3c)',
          borderRadius: 0,
          padding: '32px 40px',
          width: '400px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '8px 8px 0 rgba(0, 0, 0, 0.5)',
          zIndex: 1001,
        }}
      >
        {/* Pixel-style Header */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '24px',
          }}
        >
          <span style={{ fontSize: '48px', marginBottom: '8px' }}>🏢</span>
          <span
            style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: 'var(--pixel-accent, #007fd4)',
              textTransform: 'uppercase',
              letterSpacing: '2px',
            }}
          >
            Clawmpany
          </span>
          <span
            style={{
              fontSize: '24px',
              color: 'var(--pixel-text, #ccc)',
              marginTop: '8px',
            }}
          >
            Welcome Claw Executive Officer (CEO)!
          </span>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            marginBottom: '24px',
            border: '2px solid var(--pixel-border, #3c3c3c)',
          }}
        >
          <button
            type="button"
            onClick={() => setIsSignUp(false)}
            style={{
              flex: 1,
              padding: '12px',
              fontSize: '16px',
              fontWeight: 'bold',
              background: !isSignUp ? 'var(--pixel-accent, #007fd4)' : 'transparent',
              color: !isSignUp ? '#fff' : 'var(--pixel-text-dim, #888)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(true)}
            style={{
              flex: 1,
              padding: '12px',
              fontSize: '16px',
              fontWeight: 'bold',
              background: isSignUp ? 'var(--pixel-accent, #007fd4)' : 'transparent',
              color: isSignUp ? '#fff' : 'var(--pixel-text-dim, #888)',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Full Name - only for Sign Up */}
          {isSignUp && (
            <div style={{ marginBottom: '16px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  color: 'var(--pixel-text-dim, #888)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: '16px',
                  background: 'var(--pixel-input-bg, #2d2d2d)',
                  color: 'var(--pixel-text, #fff)',
                  border: '2px solid var(--pixel-border, #3c3c3c)',
                  borderRadius: 0,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                color: 'var(--pixel-text-dim, #888)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ceo@claw.com"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '16px',
                background: 'var(--pixel-input-bg, #2d2d2d)',
                color: 'var(--pixel-text, #fff)',
                border: '2px solid var(--pixel-border, #3c3c3c)',
                borderRadius: 0,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: isSignUp ? '16px' : '24px' }}>
            <label
              style={{
                display: 'block',
                fontSize: '14px',
                color: 'var(--pixel-text-dim, #888)',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px 14px',
                fontSize: '16px',
                background: 'var(--pixel-input-bg, #2d2d2d)',
                color: 'var(--pixel-text, #fff)',
                border: '2px solid var(--pixel-border, #3c3c3c)',
                borderRadius: 0,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Confirm Password - only for Sign Up */}
          {isSignUp && (
            <div style={{ marginBottom: '24px' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '14px',
                  color: 'var(--pixel-text-dim, #888)',
                  marginBottom: '6px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                }}
              >
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  fontSize: '16px',
                  background: 'var(--pixel-input-bg, #2d2d2d)',
                  color: 'var(--pixel-text, #fff)',
                  border: '2px solid var(--pixel-border, #3c3c3c)',
                  borderRadius: 0,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* Error Message */}
          {displayError && (
            <div
              style={{
                padding: '12px',
                marginBottom: '16px',
                background: 'rgba(220, 50, 50, 0.2)',
                border: '2px solid rgba(220, 50, 50, 0.5)',
                color: '#ff6b6b',
                fontSize: '14px',
                textAlign: 'center',
              }}
            >
              {displayError}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '18px',
              fontWeight: 'bold',
              background: loading
                ? 'var(--pixel-btn-disabled, #444)'
                : 'var(--pixel-accent, #007fd4)',
              color: '#fff',
              border: '2px solid transparent',
              cursor: loading ? 'not-allowed' : 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '2px',
              transition: 'all 0.2s',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        {/* Success message after sign up */}
        {signUpSuccess && !error && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              background: 'rgba(50, 200, 80, 0.2)',
              border: '2px solid rgba(50, 200, 80, 0.5)',
              color: '#6bff6b',
              fontSize: '14px',
              textAlign: 'center',
            }}
          >
            ✅ Account created! Check your email for verification.
          </div>
        )}
      </div>
    </>
  );
}
