import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

import type { Character } from '../office/types.js';

// API base URL - backend server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface OfficeServer {
  id: string;
  username: string;
  ip: string;
  cpu: number;
  ram: number;
  storage: number;
  isPurchased: boolean;
}

// Pixel-style avatar component
function CharacterAvatar({ character }: { character: Character }) {
  // Generate a consistent color based on palette
  const paletteColors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FFEAA7', // Yellow
    '#DDA0DD', // Plum
  ];
  const bgColor = paletteColors[character.palette % paletteColors.length];

  // Extract emoji from displayName or use default
  const emoji = character.displayName?.match(/^(\p{Emoji})/u)?.[1] || '🤖';

  return (
    <div
      style={{
        width: 40,
        height: 40,
        borderRadius: 4,
        background: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 24,
        border: '2px solid var(--pixel-border)',
        boxShadow: '2px 2px 0 rgba(0,0,0,0.3)',
        flexShrink: 0,
      }}
    >
      {emoji}
    </div>
  );
}

export function ChatSidebar({ character, isOpen, onClose, server }: { character: Character; isOpen: boolean; onClose: () => void; server: OfficeServer | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Extract name from displayName
  const emoji = character.displayName?.match(/^(\p{Emoji})/u)?.[1] || '🤖';
  const name = character.displayName?.replace(/^(\p{Emoji}\s*)/u, '') || `Agent ${character.id}`;
  const status = character.isActive ? 'Working...' : 'Idle';

  // Can chat if we have server and agentId
  const canChat = server && character.agentId;

  // Fetch chat history when sidebar opens
  useEffect(() => {
    if (!isOpen || !canChat) return;

    const fetchHistory = async () => {
      setIsLoadingHistory(true);
      setError(null);
      try {
        // First, get list of sessions
        const sessionsRes = await fetch(
          `${API_BASE_URL}/api/servers/${server.id}/sessions?agentId=${character.agentId}`
        );
        const sessionsData = await sessionsRes.json();

        if (sessionsData.success && sessionsData.data.length > 0) {
          // Get the first session (usually the main direct chat)
          const mainSession = sessionsData.data.find(
            (s: { chatType: string }) => s.chatType === 'direct'
          ) || sessionsData.data[0];

          setSessionId(mainSession.sessionId);

          // Fetch messages for this session
          const historyRes = await fetch(
            `${API_BASE_URL}/api/servers/${server.id}/sessions/${mainSession.sessionId}?agentId=${character.agentId}`
          );
          const historyData = await historyRes.json();

          if (historyData.success && historyData.data.messages) {
            setMessages(historyData.data.messages);
          }
        } else {
          // No session exists yet - session will be created on first message
          console.log('[ChatSidebar] No existing session, will create on first message');
          setSessionId(null);
        }
      } catch (error) {
        console.error('[ChatSidebar] Failed to fetch history:', error);
        setError('Failed to load chat history');
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistory();
  }, [isOpen, canChat, server, character.agentId]);

  // Scroll to bottom instantly on initial load, smooth on new messages
  const prevMessagesLengthRef = useRef(0);
  
  useEffect(() => {
    const container = messagesEndRef.current?.parentElement;
    if (!container) return;
    
    // If this is initial load (jump from 0 to many messages), scroll instantly
    if (prevMessagesLengthRef.current === 0 && messages.length > 0) {
      container.scrollTop = container.scrollHeight;
    } else if (prevMessagesLengthRef.current < messages.length) {
      // New message added - smooth scroll
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    
    prevMessagesLengthRef.current = messages.length;
  }, [messages]);

  // Track loading time
  useEffect(() => {
    if (!isLoading) {
      setLoadingSeconds(0);
      return;
    }

    setLoadingSeconds(0);
    const interval = setInterval(() => {
      setLoadingSeconds((s) => s + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isLoading]);

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading || !canChat) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      let targetSessionId = sessionId;

      // If no session exists, create one first
      if (!targetSessionId) {
        setIsCreatingSession(true);
        console.log('[ChatSidebar] Creating new session...');
        
        const createRes = await fetch(
          `${API_BASE_URL}/api/servers/${server.id}/sessions`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: character.agentId,
              initialMessage: userMessage.content,
            }),
          }
        );

        const createData = await createRes.json();
        setIsCreatingSession(false);

        if (!createData.success) {
          console.error('[ChatSidebar] Failed to create session:', createData.error);
          setError(createData.error || 'Failed to create session');
          setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
          setIsLoading(false);
          return;
        }

        // Session created with initial message - use the response directly
        targetSessionId = createData.data.sessionId;
        setSessionId(targetSessionId);

        // Add agent response if available
        if (createData.data?.response) {
          const assistantMessage: ChatMessage = {
            id: `${Date.now()}-response`,
            role: 'assistant',
            content: createData.data.response,
            timestamp: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
        }

        setIsLoading(false);
        return;
      }

      // Send message to existing session
      const res = await fetch(
        `${API_BASE_URL}/api/servers/${server.id}/sessions/${targetSessionId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: userMessage.content,
            agentId: character.agentId,
          }),
        }
      );

      const data = await res.json();

      if (!data.success) {
        console.error('[ChatSidebar] Failed to send:', data.error);
        setError(data.error || 'Failed to send message');
        // Remove the optimistic message on error
        setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        return;
      }

      // Add agent response if available
      if (data.data?.response) {
        const assistantMessage: ChatMessage = {
          id: `${Date.now()}-response`,
          role: 'assistant',
          content: data.data.response,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('[ChatSidebar] Failed to send message:', error);
      setError('Failed to send message. Please try again.');
      // Remove the optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
    } finally {
      setIsLoading(false);
    }
  }, [inputValue, isLoading, canChat, server, character.agentId, sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: 'var(--pixel-bg)',
        borderLeft: '2px solid var(--pixel-border)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 100,
        boxShadow: '-4px 0 8px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '2px solid var(--pixel-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--pixel-header-bg, rgba(0,0,0,0.2))',
        }}
      >
        <CharacterAvatar character={character} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 'bold',
              color: 'var(--pixel-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontSize: 12,
              color: character.isActive ? 'var(--pixel-accent)' : 'var(--pixel-text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: character.isActive ? '#4ade80' : '#6b7280',
              }}
            />
            {status}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--pixel-btn-bg)',
            border: '2px solid var(--pixel-border)',
            color: 'var(--pixel-text)',
            cursor: 'pointer',
            fontSize: 18,
            borderRadius: 4,
          }}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {!canChat ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pixel-text-dim)',
              textAlign: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 48 }}>🔌</span>
            <div style={{ fontSize: 14 }}>Select a server to start chatting</div>
          </div>
        ) : isLoadingHistory ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pixel-text-dim)',
            }}
          >
            <span className="pixel-agents-pulse">Loading history...</span>
          </div>
        ) : messages.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--pixel-text-dim)',
              textAlign: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 48 }}>{emoji}</span>
            <div style={{ fontSize: 14 }}>Start a conversation with {name}</div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  maxWidth: '80%',
                  padding: '10px 14px',
                  borderRadius: 4,
                  background:
                    msg.role === 'user' ? 'var(--pixel-accent)' : 'var(--pixel-card-bg, rgba(255,255,255,0.05))',
                  color: msg.role === 'user' ? '#fff' : 'var(--pixel-text)',
                  fontSize: 20,
                  lineHeight: 1.5,
                  border: msg.role === 'user' ? 'none' : '1px solid var(--pixel-border)',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 4,
                background: 'var(--pixel-card-bg, rgba(255,255,255,0.05))',
                border: '1px solid var(--pixel-border)',
                color: 'var(--pixel-text-dim)',
                fontSize: 14,
              }}
            >
              <span className="pixel-agents-pulse">
                {isCreatingSession ? 'Starting session...' : `Thinking... (${loadingSeconds}s)`}
              </span>
            </div>
          </div>
        )}
        {error && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 4,
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: '#fca5a5',
                fontSize: 12,
                textAlign: 'center',
                maxWidth: '90%',
              }}
            >
              {error}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        style={{
          padding: 12,
          borderTop: '2px solid var(--pixel-border)',
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={canChat ? `Message ${name}...` : 'Select a server first'}
          disabled={isLoading || !canChat}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 4,
            border: '2px solid var(--pixel-border)',
            background: 'var(--pixel-input-bg, rgba(0,0,0,0.3))',
            color: 'var(--pixel-text)',
            fontSize: 20,
            outline: 'none',
            opacity: canChat ? 1 : 0.6,
          }}
        />
        <button
          onClick={handleSendMessage}
          disabled={!inputValue.trim() || isLoading || !canChat}
          style={{
            width: 40,
            height: 40,
            padding: 0,
            borderRadius: 4,
            border: '2px solid var(--pixel-border)',
            background: inputValue.trim() && !isLoading && canChat ? 'var(--pixel-accent)' : 'var(--pixel-btn-bg)',
            color: inputValue.trim() && !isLoading && canChat ? '#fff' : 'var(--pixel-text-dim)',
            cursor: inputValue.trim() && !isLoading && canChat ? 'pointer' : 'not-allowed',
            opacity: inputValue.trim() && !isLoading && canChat ? 1 : 0.6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
