/**
 * Structured logging module for the Pixel Agents server.
 *
 * Addresses SEC-003: Sensitive Data Exposure in Logs
 *
 * This is a standalone module that can be used without VS Code dependencies.
 * It mirrors the functionality of src/logger.ts but without vscode imports.
 *
 * Features:
 * - Log levels: DEBUG, INFO, WARN, ERROR, NONE
 * - Path sanitization: replaces home directory with ~
 * - Session ID sanitization: partial redaction (keeps first 8 chars)
 * - Configurable via environment variable PIXEL_AGENTS_LOG_LEVEL
 */
import * as os from 'os';

/** Log level values as const object (no enums per TypeScript constraints). */
export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
} as const;

export type LogLevelValue = (typeof LogLevel)[keyof typeof LogLevel];

interface LoggerConfig {
  level: LogLevelValue;
  sanitizePaths: boolean;
  prefix: string;
}

class Logger {
  private config: LoggerConfig = {
    level: LogLevel.INFO,
    sanitizePaths: true,
    prefix: '[Pixel Agents]',
  };

  private homeDir: string = os.homedir();

  /** Set the minimum log level. Messages below this level are not logged. */
  setLevel(level: LogLevelValue): void {
    this.config.level = level;
  }

  /** Get the current log level. */
  getLevel(): LogLevelValue {
    return this.config.level;
  }

  /** Enable or disable path sanitization. */
  setSanitizePaths(sanitize: boolean): void {
    this.config.sanitizePaths = sanitize;
  }

  /** Check if path sanitization is enabled. */
  isSanitizingPaths(): boolean {
    return this.config.sanitizePaths;
  }

  /**
   * Sanitize a string to remove sensitive information:
   * - Replaces home directory paths with ~
   * - Partially redacts UUIDs (keeps first 8 chars)
   */
  sanitize(message: string): string {
    if (!this.config.sanitizePaths) return message;

    let sanitized = message;

    // Replace home directory paths (handles both forward and back slashes)
    // Escape special regex characters in the path
    const escapedHomeDir = this.homeDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sanitized = sanitized.replace(new RegExp(escapedHomeDir, 'gi'), '~');

    // Replace session UUIDs (keep first 8 chars for debugging)
    // Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    sanitized = sanitized.replace(
      /([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      '$1-****-****-****-************',
    );

    return sanitized;
  }

  private formatArgs(args: unknown[]): unknown[] {
    return args.map((a) => (typeof a === 'string' ? this.sanitize(a) : a));
  }

  /** Log a debug message. Only logged when level is DEBUG. */
  debug(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.DEBUG) {
      console.log(this.config.prefix, this.sanitize(message), ...this.formatArgs(args));
    }
  }

  /** Log an info message. Logged when level is INFO or lower. */
  info(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.INFO) {
      console.log(this.config.prefix, this.sanitize(message), ...this.formatArgs(args));
    }
  }

  /** Log a warning message. Logged when level is WARN or lower. */
  warn(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.WARN) {
      console.warn(this.config.prefix, this.sanitize(message), ...this.formatArgs(args));
    }
  }

  /** Log an error message. Logged when level is ERROR or lower. */
  error(message: string, ...args: unknown[]): void {
    if (this.config.level <= LogLevel.ERROR) {
      console.error(this.config.prefix, this.sanitize(message), ...this.formatArgs(args));
    }
  }
}

export const logger = new Logger();

/**
 * Initialize logger based on environment variables.
 * Call this at server startup.
 */
export function initializeLogger(): void {
  // Check environment variable first
  const envLevel = process.env.PIXEL_AGENTS_LOG_LEVEL?.toUpperCase();
  if (envLevel && envLevel in LogLevel) {
    logger.setLevel(LogLevel[envLevel as keyof typeof LogLevel]);
    return;
  }

  // Legacy debug flag: PIXEL_AGENTS_DEBUG=0 means suppress debug logs
  const debugEnv = process.env.PIXEL_AGENTS_DEBUG;
  if (debugEnv === '0') {
    logger.setLevel(LogLevel.WARN);
  } else if (debugEnv === '1') {
    logger.setLevel(LogLevel.DEBUG);
  }
  // Default: INFO level with sanitization enabled
}
