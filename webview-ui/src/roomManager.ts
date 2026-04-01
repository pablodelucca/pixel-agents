/**
 * Room management for multi-room architecture
 *
 * Each project gets its own room with independent layout.
 * Rooms are persisted to localStorage.
 */

export interface Room {
  id: string;
  name: string;
  projectPath?: string;  // Auto-associate with project (lowercase path)
  agentIds: string[];    // Session IDs assigned to this room
  createdAt: number;
}

export interface RoomState {
  rooms: Room[];
  activeRoomId: string | null;
}

const ROOMS_KEY = 'pixel-agents-rooms';
const LAYOUT_KEY_PREFIX = 'pixel-agents-layout-';

// Default "Pixel Office" room
export const DEFAULT_ROOM: Room = {
  id: 'default',
  name: 'Pixel Office',
  projectPath: undefined,
  agentIds: [],
  createdAt: 0,
};

export function loadRooms(): RoomState {
  try {
    const stored = localStorage.getItem(ROOMS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as RoomState;
      // Ensure default room exists
      if (!parsed.rooms.find(r => r.id === 'default')) {
        parsed.rooms.unshift(DEFAULT_ROOM);
      }
      return parsed;
    }
  } catch {}
  return {
    rooms: [DEFAULT_ROOM],
    activeRoomId: 'default',
  };
}

export function saveRooms(state: RoomState): void {
  localStorage.setItem(ROOMS_KEY, JSON.stringify(state));
}

export function createRoom(name: string, projectPath?: string): Room {
  return {
    id: `room-${Date.now()}`,
    name,
    projectPath: projectPath?.toLowerCase(),
    agentIds: [],
    createdAt: Date.now(),
  };
}

export function findRoomForProject(state: RoomState, projectPath: string): Room | undefined {
  const normalized = projectPath.toLowerCase();
  return state.rooms.find(r => r.projectPath === normalized);
}

export function findRoomForAgent(state: RoomState, sessionId: string): Room | undefined {
  return state.rooms.find(r => r.agentIds.includes(sessionId));
}

export function assignAgentToRoom(state: RoomState, sessionId: string, roomId: string): RoomState {
  // Remove from all rooms first
  const rooms = state.rooms.map(r => ({
    ...r,
    agentIds: r.agentIds.filter(id => id !== sessionId),
  }));

  // Add to target room
  const targetIndex = rooms.findIndex(r => r.id === roomId);
  if (targetIndex >= 0) {
    rooms[targetIndex] = {
      ...rooms[targetIndex],
      agentIds: [...rooms[targetIndex].agentIds, sessionId],
    };
  }

  return { ...state, rooms };
}

export function removeAgentFromAllRooms(state: RoomState, sessionId: string): RoomState {
  const rooms = state.rooms.map(r => ({
    ...r,
    agentIds: r.agentIds.filter(id => id !== sessionId),
  }));
  return { ...state, rooms };
}

export function deleteRoom(state: RoomState, roomId: string): RoomState {
  if (roomId === 'default') return state; // Cannot delete default room

  const room = state.rooms.find(r => r.id === roomId);
  if (!room) return state;

  // Move agents to default room
  const defaultIndex = state.rooms.findIndex(r => r.id === 'default');
  const rooms = state.rooms.filter(r => r.id !== roomId);

  if (room.agentIds.length > 0 && defaultIndex >= 0) {
    rooms[defaultIndex] = {
      ...rooms[defaultIndex],
      agentIds: [...rooms[defaultIndex].agentIds, ...room.agentIds],
    };
  }

  // Delete layout
  localStorage.removeItem(LAYOUT_KEY_PREFIX + roomId);

  return {
    rooms,
    activeRoomId: state.activeRoomId === roomId ? 'default' : state.activeRoomId,
  };
}

export function renameRoom(state: RoomState, roomId: string, newName: string): RoomState {
  const rooms = state.rooms.map(r =>
    r.id === roomId ? { ...r, name: newName } : r
  );
  return { ...state, rooms };
}

// Layout storage per room
export function loadRoomLayout(roomId: string): any | null {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY_PREFIX + roomId);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return null;
}

export function saveRoomLayout(roomId: string, layout: any): void {
  localStorage.setItem(LAYOUT_KEY_PREFIX + roomId, JSON.stringify(layout));
}