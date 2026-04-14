import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const tasksPath = path.resolve(process.cwd(), '.vscode', 'tasks.json');
const esbuildPath = path.resolve(process.cwd(), 'esbuild.js');

test('default VS Code build task prebuilds the webview bundle for Extension Host runs', () => {
  const contents = fs.readFileSync(tasksPath, 'utf8');

  const watchTaskMatch = contents.match(
    /"label"\s*:\s*"watch"[\s\S]*?"dependsOn"\s*:\s*\[([\s\S]*?)\]/,
  );

  assert.ok(watchTaskMatch, 'watch task with dependsOn should exist');
  assert.match(
    watchTaskMatch[1],
    /"npm:\s*build:webview"/,
    'watch task should depend on npm: build:webview so F5 can restore pixel-agents.panelView',
  );
});

test('watch-mode esbuild rebuilds refresh dist assets and hooks for Extension Host runs', () => {
  const contents = fs.readFileSync(esbuildPath, 'utf8');

  assert.match(
    contents,
    /if \(result\.errors\.length === 0\) \{\s*copyAssets\(\);\s*buildHooks\(\);\s*\}/,
    'watch-mode esbuild should refresh dist/assets and dist/hooks after successful rebuilds',
  );
});
