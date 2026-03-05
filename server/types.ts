export interface AgentState {
	id: number;
	ptyProcess: unknown;
	projectDir: string;
	jsonlFile: string;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeSubagentToolIds: Map<string, Set<string>>;
	activeSubagentToolNames: Map<string, Map<string, string>>;
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
	/** Whether this agent was detected from an external session (not spawned by us) */
	isExternal?: boolean;
	/** Display label for the session */
	label?: string;
	/** Whether this agent comes from a remote peer (join CLI) */
	isRemote?: boolean;
	/** Peer connection ID */
	peerId?: string;
	/** Agent ID on the peer's local machine */
	peerLocalId?: number;
	/** Display name of the remote peer */
	peerName?: string;
}

export interface PersistedAgent {
	id: number;
	jsonlFile: string;
	projectDir: string;
	label?: string;
}
