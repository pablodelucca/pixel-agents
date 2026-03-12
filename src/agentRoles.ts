import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AGENT_ROLES_FILE_NAME, LAYOUT_FILE_DIR } from './constants.js';

export interface AgentRole {
  title: string;
  description: string;
  prompt: string;
}

function getRolesFilePath(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, AGENT_ROLES_FILE_NAME);
}

export function readAgentRoles(): Record<string, AgentRole> {
  try {
    const filePath = getRolesFilePath();
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, AgentRole>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function writeAgentRoles(roles: Record<string, AgentRole>): void {
  const filePath = getRolesFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(roles, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath);
}
