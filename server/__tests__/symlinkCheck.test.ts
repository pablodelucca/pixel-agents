/**
 * SEC-014: Unit tests for symlink detection utility.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isSymlink } from '../../src/symlinkCheck.js';

describe('isSymlink (SEC-014)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec014-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false for a regular file', () => {
    const file = path.join(tmpDir, 'regular.txt');
    fs.writeFileSync(file, 'hello');
    expect(isSymlink(file)).toBe(false);
  });

  it('returns false for a directory', () => {
    const dir = path.join(tmpDir, 'subdir');
    fs.mkdirSync(dir);
    expect(isSymlink(dir)).toBe(false);
  });

  it('returns true for a symlink to a file', () => {
    const target = path.join(tmpDir, 'target.txt');
    const link = path.join(tmpDir, 'link.txt');
    fs.writeFileSync(target, 'sensitive data');
    fs.symlinkSync(target, link);
    expect(isSymlink(link)).toBe(true);
  });

  it('returns true for a symlink to a directory', () => {
    const targetDir = path.join(tmpDir, 'targetdir');
    const link = path.join(tmpDir, 'linkdir');
    fs.mkdirSync(targetDir);
    fs.symlinkSync(targetDir, link);
    expect(isSymlink(link)).toBe(true);
  });

  it('returns true for a dangling symlink (target does not exist)', () => {
    const link = path.join(tmpDir, 'dangling.txt');
    fs.symlinkSync('/nonexistent/path/that/does/not/exist', link);
    expect(isSymlink(link)).toBe(true);
  });

  it('returns false for a path that does not exist', () => {
    const nonexistent = path.join(tmpDir, 'does-not-exist.txt');
    expect(isSymlink(nonexistent)).toBe(false);
  });

  it('returns false for an empty string path without throwing', () => {
    expect(isSymlink('')).toBe(false);
  });
});
