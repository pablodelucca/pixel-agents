import { createContext, useCallback, useContext, useRef, useState } from 'react';

import type { AgentConfig, Server, ServerConfig } from '../types/database.js';
import type { OfficeState } from '../office/engine/officeState.js';

// API base URL - backend server
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Hash function to convert string ID to numeric ID
function hashStringToNumber(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) + 1; // Ensure positive and non-zero
}

interface ServerState {
  activeServer: Server | null;
  serverConfig: ServerConfig | null;
  isLoading: boolean;
  error: string | null;
}

interface ServerContextType extends ServerState {
  setActiveServer: (server: Server | null) => void;
  fetchServerConfig: (serverId: string) => Promise<ServerConfig | null>;
  clearActiveServer: () => void;
  syncAgentsToOffice: (officeState: OfficeState, agents: AgentConfig[], server: Server) => void;
}

const ServerContext = createContext<ServerContextType | null>(null);

export function ServerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ServerState>({
    activeServer: null,
    serverConfig: null,
    isLoading: false,
    error: null,
  });

  // Track the last synced agents for the current server
  const lastSyncedAgentsRef = useRef<string>('');

  const setActiveServer = useCallback((server: Server | null) => {
    setState((prev) => ({
      ...prev,
      activeServer: server,
      serverConfig: null, // Clear config when switching servers
      error: null,
    }));
  }, []);

  const clearActiveServer = useCallback(() => {
    setState({
      activeServer: null,
      serverConfig: null,
      isLoading: false,
      error: null,
    });
  }, []);

  const syncAgentsToOffice = useCallback((officeState: OfficeState, agents: AgentConfig[], server: Server) => {
    const serverKey = server.id;
    
    // Create a hash of the current agents to detect changes
    const agentsHash = agents && agents.length > 0 
      ? agents.map(a => a.id).sort().join(',') 
      : '__empty__';
    const syncKey = `${serverKey}:${agentsHash}`;
    
    // Skip if we already synced these exact agents for this server
    if (lastSyncedAgentsRef.current === syncKey) {
      console.log('[ServerAgents] Already synced these agents, skipping');
      return;
    }

    console.log(`[ServerAgents] Syncing ${agents?.length || 0} agents for server: ${server.name}`);

    // Clear ALL existing characters - use immediate removal to avoid animation delay
    const existingIds = [...officeState.characters.keys()];
    console.log(`[ServerAgents] Clearing ${existingIds.length} existing agents`);
    
    for (const chId of existingIds) {
      officeState.removeAgent(chId, true); // immediate = true
    }

    // If no agents, just clear and return
    if (!agents || agents.length === 0) {
      console.log('[ServerAgents] No agents to add, office is now empty');
      lastSyncedAgentsRef.current = syncKey;
      return;
    }

    // Verify all cleared
    const remainingCount = officeState.characters.size;
    if (remainingCount > 0) {
      console.warn(`[ServerAgents] Warning: ${remainingCount} agents still remaining after clear!`);
    }

    // Add all agents from config
    for (const agent of agents) {
      // Generate consistent numeric ID from string ID
      const agentId = hashStringToNumber(agent.id);

      // Create display name with emoji
      const emoji = agent.identity?.emoji || '🤖';
      const name = agent.identity?.name || agent.name || agent.id;
      const displayName = `${emoji} ${name}`;

      // Add agent to office (pass original agentId for chat API)
      officeState.addAgent(agentId, undefined, undefined, undefined, true, displayName, agent.id);
      console.log(`[ServerAgents] Added: ${displayName} (hash: ${agentId}, agentId: ${agent.id})`);
    }

    // Verify count
    const finalCount = officeState.characters.size;
    console.log(`[ServerAgents] Done! Office now has ${finalCount} agents (expected: ${agents.length})`);

    // Mark these agents as synced
    lastSyncedAgentsRef.current = syncKey;
  }, []);

  const fetchServerConfig = useCallback(async (serverId: string): Promise<ServerConfig | null> => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch(`${API_BASE_URL}/api/servers/${serverId}/config`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch config: ${response.status}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch server config');
      }

      const config = data.data as ServerConfig;

      setState((prev) => ({
        ...prev,
        serverConfig: config,
        isLoading: false,
      }));

      return config;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: errorMessage,
      }));
      console.error('Failed to fetch server config:', error);
      return null;
    }
  }, []);

  return (
    <ServerContext.Provider
      value={{
        ...state,
        setActiveServer,
        fetchServerConfig,
        clearActiveServer,
        syncAgentsToOffice,
      }}
    >
      {children}
    </ServerContext.Provider>
  );
}

export function useServerState() {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error('useServerState must be used within a ServerProvider');
  }
  return context;
}

// Hook to get agents from active server
export function useServerAgents(): {
  agents: AgentConfig[];
  isLoading: boolean;
  error: string | null;
} {
  const { serverConfig, isLoading, error } = useServerState();

  return {
    agents: serverConfig?.agents ?? [],
    isLoading,
    error,
  };
}
