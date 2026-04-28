/**
 * Zod schemas for office layout files.
 *
 * These schemas validate the structure of layout files stored at ~/.pixel-agents/layout.json
 * and imported layout files.
 */
import { z } from 'zod';

import { logger } from '../logger.js';

/**
 * Floor color settings for a tile.
 */
export const FloorColorSchema = z
  .object({
    h: z.number(),
    s: z.number(),
    b: z.number(),
    c: z.number(),
    colorize: z.boolean().optional(),
  })
  .passthrough();

export type FloorColor = z.infer<typeof FloorColorSchema>;

/**
 * Color settings for placed furniture.
 */
export const FurnitureColorSchema = z
  .object({
    h: z.number(),
    s: z.number(),
    b: z.number(),
    c: z.number(),
    colorize: z.boolean().optional(),
  })
  .passthrough();

export type FurnitureColor = z.infer<typeof FurnitureColorSchema>;

/**
 * A piece of furniture placed in the office.
 */
export const PlacedFurnitureSchema = z
  .object({
    uid: z.string(),
    type: z.string(),
    row: z.number().int(),
    col: z.number().int(),
    color: FurnitureColorSchema.optional(),
  })
  .passthrough();

export type PlacedFurniture = z.infer<typeof PlacedFurnitureSchema>;

/**
 * Complete office layout schema.
 * Version 1 is the only supported version.
 */
export const LayoutSchema = z.object({
  version: z.literal(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  tiles: z.array(z.number()),
  furniture: z.array(PlacedFurnitureSchema),
  tileColors: z.array(FloorColorSchema.nullable()).optional(),
  layoutRevision: z.number().int().optional(),
  wallColor: FloorColorSchema.optional(),
});

export type Layout = z.infer<typeof LayoutSchema>;

/**
 * Validates a parsed JSON object as a layout.
 * Returns the validated layout or null if validation fails.
 *
 * @param data - The parsed JSON object to validate
 * @param logErrors - Whether to log validation errors (default: true)
 * @returns The validated Layout or null if invalid
 */
export function validateLayout(data: unknown, logErrors = true): Layout | null {
  const result = LayoutSchema.safeParse(data);
  if (!result.success) {
    if (logErrors) {
      logger.warn('Layout validation failed:', result.error.message);
    }
    return null;
  }
  return result.data;
}

/**
 * Parses and validates a JSON string as a layout.
 * Returns the validated layout or null if parsing/validation fails.
 *
 * @param json - The raw JSON string
 * @param logErrors - Whether to log validation errors (default: true)
 * @returns The validated Layout or null if invalid
 */
export function parseLayout(json: string, logErrors = true): Layout | null {
  try {
    const parsed = JSON.parse(json);
    return validateLayout(parsed, logErrors);
  } catch (e) {
    if (logErrors) {
      logger.error('Failed to parse layout JSON:', e);
    }
    return null;
  }
}

/**
 * Checks if a layout has valid basic structure (version + tiles).
 * This is a lighter check for import validation before full schema validation.
 *
 * @param data - The parsed JSON object to check
 * @returns True if the basic structure is valid
 */
export function hasValidLayoutStructure(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return obj.version === 1 && Array.isArray(obj.tiles);
}
