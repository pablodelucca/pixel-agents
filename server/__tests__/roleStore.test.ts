// server/__tests__/roleStore.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RoleStore } from '../src/orchestrator/roleStore.js';

describe('RoleStore', () => {
  let tmpDir: string;
  let rolesPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rolestore-'));
    rolesPath = path.join(tmpDir, 'roles.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns bundled defaults when file does not exist', async () => {
    const bundledDefaultsPath = path.join(tmpDir, 'default-roles.json');
    fs.writeFileSync(
      bundledDefaultsPath,
      JSON.stringify({
        version: 1,
        roles: { foo: { id: 'foo', label: 'Foo', systemPrompt: 'p', palette: 0, hueShift: 0 } },
      }),
    );
    const store = new RoleStore(rolesPath, bundledDefaultsPath);
    const roles = await store.list();
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe('foo');
  });

  it('reads existing roles.json and returns its roles', async () => {
    fs.writeFileSync(
      rolesPath,
      JSON.stringify({
        version: 1,
        roles: {
          bar: { id: 'bar', label: 'Bar', systemPrompt: 's', palette: 1, hueShift: 45 },
        },
      }),
    );
    const store = new RoleStore(rolesPath, '/nonexistent');
    const roles = await store.list();
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe('bar');
    expect(roles[0].hueShift).toBe(45);
  });

  it('get() returns undefined for unknown id', async () => {
    const store = new RoleStore(rolesPath, '/nonexistent');
    // seed with empty
    fs.writeFileSync(rolesPath, JSON.stringify({ version: 1, roles: {} }));
    expect(await store.get('missing')).toBeUndefined();
  });

  it('rejects malformed JSON and throws a clear error', async () => {
    fs.writeFileSync(rolesPath, 'not-json');
    const store = new RoleStore(rolesPath, '/nonexistent');
    await expect(store.list()).rejects.toThrow(/parse/i);
  });
});
