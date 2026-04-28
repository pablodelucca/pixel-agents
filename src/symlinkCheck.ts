import * as fs from 'fs';

/**
 * SEC-014: Symlink attack surface mitigation.
 *
 * Returns true if the given path is a symbolic link.
 * Returns false if the path does not exist, is a regular file/directory, or an error occurs.
 *
 * Use this before reading security-sensitive files to prevent symlink-based path traversal
 * attacks on user-writable directories (~/.pixel-agents/, ~/.claude/projects/, external dirs).
 */
export function isSymlink(filePath: string): boolean {
  try {
    return fs.lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
}
