import * as fs from 'fs';
import * as path from 'path';

export function toProjectDirName(workspacePath: string): string {
  return workspacePath.replace(/[^a-zA-Z0-9-]/g, '-');
}

export function getProjectDirPath(workspacePath: string, projectsRoot: string): string {
  const dirName = toProjectDirName(workspacePath);
  return path.join(projectsRoot, dirName);
}

export function findSessionFileById(projectsRoot: string, sessionId: string): string | null {
  try {
    if (!fs.existsSync(projectsRoot)) return null;

    const directPath = path.join(projectsRoot, `${sessionId}.jsonl`);
    if (fs.existsSync(directPath)) return directPath;

    const entries = fs.readdirSync(projectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(projectsRoot, entry.name, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export function listJsonlFiles(dirPath: string): string[] {
  try {
    if (!fs.existsSync(dirPath)) return [];
    return fs
      .readdirSync(dirPath)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => path.join(dirPath, name));
  } catch {
    return [];
  }
}
