import * as fs from 'fs';

/**
 * Read area mappings from the `.code-workspace` file.
 * Returns a Record<folderName, areaLabels[]> or empty object.
 * Handles both legacy string values and new array values.
 */
export function readWorkspaceAreaMappings(workspaceFilePath: string): Record<string, string[]> {
  try {
    if (!fs.existsSync(workspaceFilePath)) return {};
    const raw = fs.readFileSync(workspaceFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pixelAgents = parsed['pixel-agents'] as Record<string, unknown> | undefined;
    if (!pixelAgents || typeof pixelAgents !== 'object') return {};
    const mappings = pixelAgents.areaMappings as Record<string, unknown> | undefined;
    if (!mappings || typeof mappings !== 'object') return {};
    const result: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(mappings)) {
      if (typeof value === 'string') {
        // Legacy: single string → wrap in array
        result[key] = [value];
      } else if (Array.isArray(value)) {
        result[key] = value.filter((v): v is string => typeof v === 'string');
      }
    }
    return result;
  } catch (err) {
    console.error('[Pixel Agents] Failed to read workspace area mappings:', err);
    return {};
  }
}

/**
 * Write area mappings to the `.code-workspace` file under `pixel-agents.areaMappings`.
 * Preserves all other keys in the workspace file.
 */
export function writeWorkspaceAreaMappings(
  workspaceFilePath: string,
  mappings: Record<string, string[]>,
): void {
  try {
    let parsed: Record<string, unknown> = {};
    if (fs.existsSync(workspaceFilePath)) {
      const raw = fs.readFileSync(workspaceFilePath, 'utf-8');
      parsed = JSON.parse(raw) as Record<string, unknown>;
    }
    const pixelAgents = (parsed['pixel-agents'] as Record<string, unknown> | undefined) ?? {};
    pixelAgents.areaMappings = mappings;
    parsed['pixel-agents'] = pixelAgents;
    const json = JSON.stringify(parsed, null, 2);
    const tmpPath = workspaceFilePath + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, workspaceFilePath);
  } catch (err) {
    console.error('[Pixel Agents] Failed to write workspace area mappings:', err);
  }
}
