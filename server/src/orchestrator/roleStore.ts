// server/src/orchestrator/roleStore.ts
import * as fs from 'fs';
import * as path from 'path';

import type { Role, RolesFile } from './types.js';

export class RoleStore {
  /**
   * @param userFilePath ~/.pixel-agents/roles.json (preferência do usuário)
   * @param bundledDefaultsPath caminho absoluto do default-roles.json bundled
   */
  constructor(
    private userFilePath: string,
    private bundledDefaultsPath: string,
  ) {}

  async list(): Promise<Role[]> {
    const file = await this.load();
    return Object.values(file.roles);
  }

  async get(id: string): Promise<Role | undefined> {
    const file = await this.load();
    return file.roles[id];
  }

  private async load(): Promise<RolesFile> {
    const sourcePath = fs.existsSync(this.userFilePath)
      ? this.userFilePath
      : this.bundledDefaultsPath;
    if (!fs.existsSync(sourcePath)) {
      return { version: 1, roles: {} };
    }
    let raw: string;
    try {
      raw = await fs.promises.readFile(sourcePath, 'utf-8');
    } catch (e) {
      throw new Error(`RoleStore: failed to read ${sourcePath}: ${(e as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`RoleStore: failed to parse ${sourcePath}: ${(e as Error).message}`);
    }
    const file = parsed as RolesFile;
    if (
      file === null ||
      typeof file !== 'object' ||
      (file as { version?: unknown }).version !== 1 ||
      typeof (file as { roles?: unknown }).roles !== 'object' ||
      (file as { roles: unknown }).roles === null ||
      Array.isArray((file as { roles: unknown }).roles)
    ) {
      throw new Error(`RoleStore: invalid file shape in ${sourcePath}`);
    }
    return file;
  }

  /** Escreve o arquivo atomicamente (tmp + rename). Usado por Fase 4. */
  async save(file: RolesFile): Promise<void> {
    const dir = path.dirname(this.userFilePath);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = this.userFilePath + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    await fs.promises.rename(tmp, this.userFilePath);
  }
}
