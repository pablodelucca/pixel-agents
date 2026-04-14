import type { ProviderDescriptor, ProviderId } from './providerTypes.js';

export interface ProviderLaunchRequest {
  sessionId: string;
  bypassPermissions?: boolean;
  cwd: string;
  extensionPath: string;
  serverPort?: number;
  serverToken?: string;
}

export interface ProviderLaunchPlan {
  command: string;
  env?: Record<string, string>;
}

export interface ProviderAdapter {
  id: ProviderId;
  descriptor: ProviderDescriptor;
  usesTranscriptFile: boolean;
  terminalLabel(index: number): string;
  matchesTerminalLabel(terminalName: string): boolean;
  buildLaunchPlan(input: ProviderLaunchRequest): ProviderLaunchPlan;
  getProjectDir(cwd?: string): string;
  getProjectsRoot?(): string;
  installIntegration?(extensionPath: string): void;
  uninstallIntegration?(): void;
}
