import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';

import {
  getProjectDirPath,
  resolveProviderAdapter,
  type SessionProviderAdapter,
  type StoredAgentProviderConfig,
} from '../../../packages/core/src/index.js';
import { loadAllDesktopAssets } from './assets.js';
import { SessionWatcher, deriveFolderName } from './sessionWatcher.js';
import {
  loadLayoutWithFallback,
  readDesktopConfig,
  readLayoutFromFile,
  writeDesktopConfig,
  writeLayoutToFile,
} from './storage.js';
import { PtyTerminalRuntime, type AgentHandle } from './terminalRuntime.js';
import type {
  DesktopConfig,
  HostToRendererMessage,
  OpenAgentPayload,
  RendererToHostMessage,
} from './types.js';

interface DesktopAgent {
  id: number;
  sessionId: string;
  cwd: string;
  folderName: string;
  providerConfig: StoredAgentProviderConfig;
  providerAdapter: SessionProviderAdapter;
  terminalHandle: AgentHandle;
  watcher: SessionWatcher;
  dataSubscription?: { dispose(): void };
  exitSubscription?: { dispose(): void };
}

const APP_VERSION = 'desktop-0.1.0';

let mainWindow: BrowserWindow | null = null;
let config: DesktopConfig = readDesktopConfig();
const terminalRuntime = new PtyTerminalRuntime();
const agents = new Map<number, DesktopAgent>();
let nextAgentId = 1;

function repoRootFromDist(): string {
  return path.resolve(__dirname, '../../..');
}

function resolveAssetsRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets');
  }
  return path.join(repoRootFromDist(), 'webview-ui', 'public', 'assets');
}

function resolveWebviewFile(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'webview', 'index.html');
  }
  return path.join(repoRootFromDist(), 'dist', 'webview', 'index.html');
}

function sendToRenderer(message: HostToRendererMessage): void {
  if (!mainWindow) return;
  mainWindow.webContents.send('pixel-agents:host-message', message);
}

function pushRuntimeLog(level: 'info' | 'error', message: string, agentId?: number): void {
  sendToRenderer({
    type: 'runtimeLog',
    level,
    message,
    agentId,
  });
}

function resolveWorkspaceFolders(): Array<{ name: string; path: string }> {
  const projectDir = config.lastProjectDirectory || process.cwd();
  return [{ name: deriveFolderName(projectDir), path: projectDir }];
}

function sendSettings(): void {
  const runtime = resolveProviderAdapter(config.provider);
  sendToRenderer({
    type: 'settingsLoaded',
    soundEnabled: config.soundEnabled,
    watchAllSessions: config.watchAllSessions,
    alwaysShowLabels: config.alwaysShowLabels,
    externalAssetDirectories: config.externalAssetDirectories,
    agentProviderId: runtime.id,
    agentProviderName: runtime.displayName,
    agentSupportsBypassPermissions: runtime.supportsBypassPermissions,
    extensionVersion: APP_VERSION,
    lastSeenVersion: '',
  });
}

function sendLayout(): void {
  const layout = readLayoutFromFile();
  sendToRenderer({ type: 'layoutLoaded', layout, wasReset: false });
}

function sendAssets(): void {
  const assets = loadAllDesktopAssets(resolveAssetsRoot(), config.externalAssetDirectories);
  sendToRenderer({ type: 'characterSpritesLoaded', characters: assets.characters });
  sendToRenderer({ type: 'floorTilesLoaded', sprites: assets.floors });
  sendToRenderer({ type: 'wallTilesLoaded', sets: assets.walls });
  sendToRenderer({
    type: 'furnitureAssetsLoaded',
    catalog: assets.furnitureCatalog,
    sprites: assets.furnitureSprites,
  });
}

function sendExistingAgents(): void {
  const ids = [...agents.values()].map((agent) => agent.id);
  const folderNames = Object.fromEntries(
    [...agents.values()].map((agent) => [agent.id, agent.folderName]),
  );
  sendToRenderer({
    type: 'existingAgents',
    agents: ids,
    agentMeta: {},
    folderNames,
  });
}

function persistConfig(): void {
  writeDesktopConfig(config);
}

function applyRememberedProvider(
  provider: StoredAgentProviderConfig,
  rememberProviderDefault?: boolean,
): void {
  if (!rememberProviderDefault && !config.rememberProviderChoice) return;
  config = { ...config, provider };
  persistConfig();
  sendSettings();
}

function openAgent(payload: OpenAgentPayload): void {
  const requestedCwd = payload.folderPath
    ? path.resolve(payload.folderPath)
    : config.lastProjectDirectory || process.cwd();
  const cwd = fs.existsSync(requestedCwd) ? requestedCwd : process.cwd();
  if (!fs.existsSync(requestedCwd)) {
    sendToRenderer({
      type: 'hostError',
      message: `Pasta inválida: ${requestedCwd}. Usando ${cwd}.`,
    });
  }
  const providerConfig = payload.providerOverride ?? config.provider;
  const providerAdapter = resolveProviderAdapter(providerConfig);
  const sessionId = randomUUID();
  const launchCommand = providerAdapter.buildLaunchCommand(sessionId, payload.bypassPermissions);
  const id = nextAgentId++;
  const startedAtMs = Date.now();
  pushRuntimeLog('info', `[Agent ${id}] comando: ${launchCommand}`, id);
  pushRuntimeLog('info', `[Agent ${id}] sessions root: ${providerAdapter.projectsRoot}`, id);

  try {
    const terminalHandle = terminalRuntime.spawn({
      agentId: id,
      sessionId,
      cwd,
      command: launchCommand,
    });

    const projectDir = getProjectDirPath(cwd, providerAdapter.projectsRoot);
    const expectedJsonlFile =
      providerAdapter.id === 'codex'
        ? path.join(providerAdapter.projectsRoot, `${sessionId}.jsonl`)
        : path.join(projectDir, `${sessionId}.jsonl`);

    const watcher = new SessionWatcher({
      agentId: id,
      sessionId,
      expectedJsonlFile,
      cwd,
      startedAtMs,
      isSessionFileClaimed: (candidateFilePath: string): boolean =>
        [...agents.values()].some(
          (existing) =>
            existing.id !== id &&
            path.resolve(existing.watcher.getSessionFile()) === path.resolve(candidateFilePath),
        ),
      providerAdapter,
      onMessage: sendToRenderer,
    });
    watcher.start();
    pushRuntimeLog('info', `[Agent ${id}] backend: ${terminalHandle.backend}`, id);

    const emitPtyChunk = (chunk: string, isError: boolean): void => {
      const lines = chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        const clipped = line.length > 240 ? `${line.slice(0, 240)}...` : line;
        pushRuntimeLog(isError ? 'error' : 'info', `[Agent ${id}] ${clipped}`, id);
      }
    };

    const dataSubscription = terminalHandle.process.onData((chunk) => {
      emitPtyChunk(chunk, false);
    });
    const exitSubscription = terminalHandle.process.onExit(({ exitCode, signal }) => {
      if (exitCode === 0) {
        pushRuntimeLog('info', `[Agent ${id}] terminal finalizado`, id);
        return;
      }
      const signalLabel = signal ? `, signal=${signal}` : '';
      pushRuntimeLog(
        'error',
        `[Agent ${id}] terminal encerrou com código ${exitCode}${signalLabel}`,
        id,
      );
    });

    const folderName = deriveFolderName(cwd);
    agents.set(id, {
      id,
      sessionId,
      cwd,
      folderName,
      providerConfig,
      providerAdapter,
      terminalHandle,
      watcher,
      dataSubscription,
      exitSubscription,
    });

    config = { ...config, lastProjectDirectory: cwd };
    persistConfig();
    applyRememberedProvider(providerConfig, payload.rememberProviderDefault);

    sendToRenderer({ type: 'workspaceFolders', folders: resolveWorkspaceFolders() });
    sendToRenderer({ type: 'agentCreated', id, folderName });
    pushRuntimeLog(
      'info',
      `[Agent ${id}] iniciado com ${providerAdapter.displayName} em ${cwd}`,
      id,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendToRenderer({
      type: 'hostError',
      message: `Falha ao iniciar agente ${providerAdapter.displayName}: ${message}`,
    });
  }
}

function closeAgent(agentId: number): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  agent.dataSubscription?.dispose();
  agent.exitSubscription?.dispose();
  agent.watcher.dispose();
  terminalRuntime.dispose(agentId);
  agents.delete(agentId);
  sendToRenderer({ type: 'agentClosed', id: agentId });
}

async function pickProjectFolder(): Promise<void> {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  sendToRenderer({ type: 'projectFolderPicked', folderPath: result.filePaths[0] });
}

async function addExternalAssetDirectory(): Promise<void> {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return;
  const newPath = result.filePaths[0];
  if (!config.externalAssetDirectories.includes(newPath)) {
    config = {
      ...config,
      externalAssetDirectories: [...config.externalAssetDirectories, newPath],
    };
    persistConfig();
  }
  sendToRenderer({
    type: 'externalAssetDirectoriesUpdated',
    dirs: config.externalAssetDirectories,
  });
  sendAssets();
}

function removeExternalAssetDirectory(targetPath: string): void {
  config = {
    ...config,
    externalAssetDirectories: config.externalAssetDirectories.filter(
      (entry) => entry !== targetPath,
    ),
  };
  persistConfig();
  sendToRenderer({
    type: 'externalAssetDirectoriesUpdated',
    dirs: config.externalAssetDirectories,
  });
  sendAssets();
}

async function exportLayout(): Promise<void> {
  if (!mainWindow) return;
  const currentLayout = readLayoutFromFile();
  if (!currentLayout) return;

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Pixel Agents Layout',
    defaultPath: 'pixel-agents-layout.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return;
  fs.writeFileSync(result.filePath, JSON.stringify(currentLayout, null, 2), 'utf-8');
}

async function importLayout(): Promise<void> {
  if (!mainWindow) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return;

  const filePath = result.filePaths[0];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  if (parsed.version !== 1 || !Array.isArray(parsed.tiles)) {
    sendToRenderer({ type: 'hostError', message: 'Layout inválido. Esperado version:1 e tiles[]' });
    return;
  }
  writeLayoutToFile(parsed);
  sendToRenderer({ type: 'layoutLoaded', layout: parsed, wasReset: false });
}

async function handleRendererMessage(message: RendererToHostMessage): Promise<void> {
  switch (message.type) {
    case 'webviewReady': {
      sendToRenderer({ type: 'workspaceFolders', folders: resolveWorkspaceFolders() });
      sendSettings();
      sendLayout();
      sendAssets();
      sendExistingAgents();
      return;
    }
    case 'openAgent':
      openAgent(message);
      return;
    case 'focusAgent':
      terminalRuntime.focus(message.id);
      sendToRenderer({ type: 'agentSelected', id: message.id });
      return;
    case 'closeAgent':
      closeAgent(message.id);
      return;
    case 'saveLayout':
      writeLayoutToFile(message.layout);
      return;
    case 'setSoundEnabled':
      config = { ...config, soundEnabled: message.enabled };
      persistConfig();
      return;
    case 'setWatchAllSessions':
      config = { ...config, watchAllSessions: message.enabled };
      persistConfig();
      return;
    case 'setAlwaysShowLabels':
      config = { ...config, alwaysShowLabels: message.enabled };
      persistConfig();
      return;
    case 'addExternalAssetDirectory':
      await addExternalAssetDirectory();
      return;
    case 'removeExternalAssetDirectory':
      removeExternalAssetDirectory(message.path);
      return;
    case 'pickProjectFolder':
      await pickProjectFolder();
      return;
    case 'exportLayout':
      await exportLayout();
      return;
    case 'importLayout':
      await importLayout();
      return;
    case 'configureAgentProvider':
      sendToRenderer({
        type: 'hostError',
        message: 'Configure o provider no modal de criação de agente e marque "Lembrar".',
      });
      return;
    case 'configureProvider':
      config = {
        ...config,
        provider: message.provider,
        rememberProviderChoice:
          typeof message.rememberProviderDefault === 'boolean'
            ? message.rememberProviderDefault
            : config.rememberProviderChoice,
      };
      persistConfig();
      sendSettings();
      sendToRenderer({ type: 'providerConfigured', provider: message.provider });
      return;
    case 'openSessionsFolder': {
      const root = resolveProviderAdapter(config.provider).projectsRoot;
      await shell.openPath(root);
      return;
    }
    case 'saveAgentSeats':
    case 'setLastSeenVersion':
      return;
  }
}

function createMainWindow(): void {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });

  const webviewFile = resolveWebviewFile();
  if (!fs.existsSync(webviewFile)) {
    throw new Error(
      `Renderer não encontrado em ${webviewFile}. Execute primeiro: npm run build:webview`,
    );
  }
  void mainWindow.loadFile(webviewFile);
}

function bootstrapLayout(): void {
  const { layout } = loadLayoutWithFallback(resolveAssetsRoot());
  if (layout) {
    writeLayoutToFile(layout);
  }
}

function disposeAllAgents(): void {
  for (const agentId of [...agents.keys()]) {
    closeAgent(agentId);
  }
  terminalRuntime.disposeAll();
}

app.whenReady().then(() => {
  bootstrapLayout();
  createMainWindow();

  ipcMain.handle('pixel-agents:post-message', async (_event, message: RendererToHostMessage) => {
    await handleRendererMessage(message);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('before-quit', () => {
  disposeAllAgents();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
