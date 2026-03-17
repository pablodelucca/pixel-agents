import type { IPixelAgentsPlugin } from './types.js';

let activePlugin: IPixelAgentsPlugin | undefined;

export function registerPlugin(plugin: IPixelAgentsPlugin): void {
  activePlugin = plugin;
}

export function getPlugin(): IPixelAgentsPlugin {
  if (!activePlugin) throw new Error('[Pixel Agents] No plugin registered');
  return activePlugin;
}
