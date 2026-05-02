// server/src/orchestrator/types.ts

/** Um papel configurável que define o comportamento + visual de um agente headless. */
export interface Role {
  /** Identificador único (slug lowercase, usado como key em roles.json). */
  id: string;
  /** Nome humano exibido no UI. */
  label: string;
  /** System prompt adicional injetado via --append-system-prompt. */
  systemPrompt: string;
  /** Índice de paleta do personagem (0-5), mapeia pra char_0..char_5.png. */
  palette: number;
  /** Hue shift em graus (-180 a 180), aplicado sobre a paleta base. */
  hueShift: number;
  /** Lista de ferramentas permitidas (passada via --allowed-tools). Vazio = todas. */
  allowedTools?: string[];
  /** Se true, papel foi criado dinamicamente pelo orquestrador (Fase 4). */
  dynamic?: boolean;
}

/** Request vindo do comando VS Code pra delegar uma tarefa. */
export interface DelegationRequest {
  roleId: string;
  task: string;
  /** Diretório de trabalho. Default: workspace root. */
  cwd?: string;
}

/** Resultado do spawn headless: processo + metadados pra tracking. */
export interface HeadlessSpawnResult {
  sessionId: string;
  process: import('child_process').ChildProcess;
  roleId: string;
  task: string;
  cwd: string;
  startedAt: number;
}

/** Arquivo roles.json tem versão + map de roles. */
export interface RolesFile {
  version: 1;
  roles: Record<string, Role>;
}
