import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';

import { JSONL_RECORD_READ_BYTES } from '../constants.js';

export function findJsonlFilesRecursive(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findJsonlFilesRecursive(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        results.push(fullPath);
      }
    }
  } catch (e) {
    console.warn(`[Pixel Agents] Error scanning for jsonl files in ${dir}:`, e);
  }
  return results;
}

export function normalizeWorkspacePath(value: string): string {
  return path.normalize(value);
}

export function readFirstJsonlRecord(file: string): Record<string, unknown> | null {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(JSONL_RECORD_READ_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    if (bytesRead === 0) return null;
    const firstLine = buf.toString('utf-8', 0, bytesRead).split('\n')[0];
    if (!firstLine) return null;
    return JSON.parse(firstLine) as Record<string, unknown>;
  } catch (error) {
    console.warn(`[Pixel Agents] Failed to read initial JSONL record from ${file}:`, error);
    return null;
  }
}

export function codexSessionBelongsToWorkspace(
  file: string,
  workspaceFolders?: readonly vscode.WorkspaceFolder[],
): boolean {
  if (!workspaceFolders || workspaceFolders.length === 0) return false;
  const record = readFirstJsonlRecord(file);
  const payload =
    record?.type === 'session_meta' && typeof record.payload === 'object' && record.payload
      ? (record.payload as Record<string, unknown>)
      : null;
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : undefined;
  if (typeof cwd !== 'string' || !cwd) return false;
  const normalizedCwd = normalizeWorkspacePath(cwd).toLowerCase();
  return workspaceFolders.some(
    (folder) => normalizeWorkspacePath(folder.uri.fsPath).toLowerCase() === normalizedCwd,
  );
}

export function toClaudeProjectHash(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
}
