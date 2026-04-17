/**
 * Schema validation module for Pixel Agents.
 *
 * Provides Zod-based runtime validation for all JSON data parsed from external sources:
 * - JSONL transcript records from Claude Code
 * - Layout files (~/.pixel-agents/layout.json)
 * - Configuration files (~/.pixel-agents/config.json)
 *
 * @see SEC-001 - JSON Schema Validation security issue
 */

export {
  ConfigSchema,
  DEFAULT_CONFIG,
  parseConfig,
  type PixelAgentsConfig,
  validateConfig,
} from './config.js';
export {
  type FloorColor,
  FloorColorSchema,
  type FurnitureColor,
  FurnitureColorSchema,
  hasValidLayoutStructure,
  type Layout,
  LayoutSchema,
  parseLayout,
  type PlacedFurniture,
  PlacedFurnitureSchema,
  validateLayout,
} from './layout.js';
export {
  parseTranscriptLine,
  type TranscriptRecord,
  TranscriptRecordSchema,
  validateTranscriptRecord,
} from './transcript.js';
