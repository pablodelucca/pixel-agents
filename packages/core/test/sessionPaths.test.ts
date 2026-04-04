import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { findSessionFileById, getProjectDirPath, toProjectDirName } from '../src/sessionPaths.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('sessionPaths', () => {
  it('creates a project directory hash compatible with legacy format', () => {
    const workspacePath = '/Users/demo/workspace:alpha';
    assert.equal(toProjectDirName(workspacePath), '-Users-demo-workspace-alpha');
    assert.equal(
      getProjectDirPath(workspacePath, '/tmp/projects'),
      '/tmp/projects/-Users-demo-workspace-alpha',
    );
  });

  it('finds a session JSONL inside nested provider folder', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-core-'));
    tempDirs.push(tempRoot);
    const nested = path.join(tempRoot, 'workspace-a');
    fs.mkdirSync(nested, { recursive: true });
    const expected = path.join(nested, 'session-1.jsonl');
    fs.writeFileSync(expected, '{}\n', 'utf-8');

    assert.equal(findSessionFileById(tempRoot, 'session-1'), expected);
  });
});
