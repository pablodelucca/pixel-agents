/**
 * Zod schemas for JSONL transcript records from Claude Code.
 *
 * These schemas validate the structure of records read from ~/.claude/projects/<hash>/<session>.jsonl.
 * Uses `.passthrough()` to allow forward-compatibility with new fields Claude may add.
 */
import { z } from 'zod';

/**
 * Usage statistics block that may appear in assistant messages.
 */
const UsageSchema = z
  .object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
  })
  .passthrough();

/**
 * Generic content block - can be tool_use, text, tool_result, or other types.
 * Using a generic schema with passthrough for forward compatibility.
 */
const ContentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough();

/**
 * Message wrapper that may contain content and usage.
 */
const MessageSchema = z
  .object({
    content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
    usage: UsageSchema.optional(),
  })
  .passthrough();

/**
 * Progress data for agent_progress, bash_progress, mcp_progress records.
 */
const ProgressDataSchema = z
  .object({
    type: z.string().optional(),
    message: z.record(z.unknown()).optional(),
  })
  .passthrough();

/**
 * Base transcript record schema.
 * Uses discriminated union on 'type' field but with passthrough for flexibility.
 */
export const TranscriptRecordSchema = z
  .object({
    // Required: record type
    type: z.enum([
      'assistant',
      'user',
      'system',
      'progress',
      'queue-operation',
      'file-history-snapshot',
    ]),
    // Optional: message wrapper (common in assistant/user records)
    message: MessageSchema.optional(),
    // Optional: direct content (some record formats put content at top level)
    content: z.union([z.string(), z.array(ContentBlockSchema)]).optional(),
    // Optional: subtype for system records
    subtype: z.string().optional(),
    // Optional: operation for queue-operation records
    operation: z.string().optional(),
    // Optional: parent tool ID for progress records
    parentToolUseID: z.string().optional(),
    // Optional: progress data
    data: ProgressDataSchema.optional(),
    // Agent Teams metadata
    teamName: z.string().optional(),
    agentName: z.string().optional(),
  })
  .passthrough();

export type TranscriptRecord = z.infer<typeof TranscriptRecordSchema>;

/**
 * Validates a parsed JSON object as a transcript record.
 * Returns the validated record or null if validation fails.
 *
 * @param data - The parsed JSON object to validate
 * @returns The validated TranscriptRecord or null if invalid
 */
export function validateTranscriptRecord(data: unknown): TranscriptRecord | null {
  const result = TranscriptRecordSchema.safeParse(data);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Parses and validates a JSONL line as a transcript record.
 * Returns the validated record or null if parsing/validation fails.
 *
 * @param line - The raw JSONL line string
 * @returns The validated TranscriptRecord or null if invalid
 */
export function parseTranscriptLine(line: string): TranscriptRecord | null {
  try {
    const parsed = JSON.parse(line);
    return validateTranscriptRecord(parsed);
  } catch {
    return null;
  }
}
