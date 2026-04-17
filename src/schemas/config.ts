/**
 * Zod schemas for pixel-agents configuration files.
 *
 * These schemas validate the structure of config files stored at ~/.pixel-agents/config.json.
 */
import { z } from 'zod';

/**
 * Complete configuration schema for Pixel Agents.
 */
export const ConfigSchema = z.object({
  externalAssetDirectories: z.array(z.string()).default([]),
});

export type PixelAgentsConfig = z.infer<typeof ConfigSchema>;

/**
 * Default configuration values.
 */
export const DEFAULT_CONFIG: PixelAgentsConfig = {
  externalAssetDirectories: [],
};

/**
 * Validates a parsed JSON object as a config.
 * Returns a validated config with defaults applied for missing fields.
 *
 * @param data - The parsed JSON object to validate
 * @param logErrors - Whether to log validation errors (default: true)
 * @returns The validated PixelAgentsConfig with defaults
 */
export function validateConfig(data: unknown, logErrors = true): PixelAgentsConfig {
  // Handle null/undefined gracefully
  if (data === null || data === undefined) {
    return { ...DEFAULT_CONFIG };
  }

  const result = ConfigSchema.safeParse(data);
  if (!result.success) {
    if (logErrors) {
      console.warn('[Pixel Agents] Config validation failed:', result.error.message);
    }
    // Return default config on validation failure
    return { ...DEFAULT_CONFIG };
  }
  return result.data;
}

/**
 * Parses and validates a JSON string as a config.
 * Returns a validated config with defaults applied for missing fields.
 *
 * @param json - The raw JSON string
 * @param logErrors - Whether to log validation errors (default: true)
 * @returns The validated PixelAgentsConfig with defaults
 */
export function parseConfig(json: string, logErrors = true): PixelAgentsConfig {
  try {
    const parsed = JSON.parse(json);
    return validateConfig(parsed, logErrors);
  } catch (e) {
    if (logErrors) {
      console.error('[Pixel Agents] Failed to parse config JSON:', e);
    }
    return { ...DEFAULT_CONFIG };
  }
}
