#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const summaryPath = process.env.GITHUB_STEP_SUMMARY || null;

const ALLOWED_FILES = new Set([
  'src/constants.ts',
  'webview-ui/src/constants.ts',
  'webview-ui/src/index.css',
]);

const EXCLUDED_PREFIXES = [
  'webview-ui/src/fonts/',
  'webview-ui/src/office/sprites/',
];

const COLOR_LITERAL_PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/,
  /\brgba?\s*\(/,
  /\bhsla?\s*\(/,
];

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeSummary(markdown) {
  if (!summaryPath) return;
  fs.appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
}

function isRelevantFile(filePath) {
  if (!filePath) return false;
  if (ALLOWED_FILES.has(filePath)) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => filePath.startsWith(prefix))) return false;

  if (filePath.startsWith('src/') && filePath.endsWith('.ts')) return true;
  if (filePath.startsWith('webview-ui/src/') && /\.(ts|tsx|css)$/.test(filePath)) return true;

  return false;
}

function detectMode() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const baseRef = process.env.GITHUB_BASE_REF;
  const beforeSha = process.env.GITHUB_EVENT_BEFORE;

  if (eventName === 'pull_request' && baseRef) {
    const remoteBaseRef = `origin/${baseRef}`;
    try {
      runGit(['rev-parse', '--verify', remoteBaseRef]);
      return {
        mode: 'diff',
        label: `changed lines against ${remoteBaseRef}`,
        args: ['diff', '--unified=0', '--no-color', `${remoteBaseRef}...HEAD`],
      };
    } catch {
      // Fall through to other modes.
    }
  }

  if (beforeSha && !/^0+$/.test(beforeSha)) {
    try {
      runGit(['rev-parse', '--verify', beforeSha]);
      return {
        mode: 'diff',
        label: `changed lines against ${beforeSha.slice(0, 12)}`,
        args: ['diff', '--unified=0', '--no-color', `${beforeSha}...HEAD`],
      };
    } catch {
      // Fall through to other modes.
    }
  }

  return {
    mode: 'full',
    label: 'full repository scan',
  };
}

function parseDiff(diffText) {
  const fileMap = new Map();
  let currentFile = null;
  let currentLine = 0;

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('+++ b/')) {
      currentFile = rawLine.slice('+++ b/'.length);
      if (!fileMap.has(currentFile)) {
        fileMap.set(currentFile, []);
      }
      continue;
    }

    const hunkMatch = rawLine.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      currentLine = Number(hunkMatch[1]);
      continue;
    }

    if (!currentFile || rawLine.startsWith('diff --git') || rawLine.startsWith('--- ')) {
      continue;
    }

    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      fileMap.get(currentFile).push({
        lineNumber: currentLine,
        text: rawLine.slice(1),
      });
      currentLine += 1;
      continue;
    }

    if (rawLine.startsWith('-')) {
      continue;
    }

    currentLine += 1;
  }

  return fileMap;
}

function collectFullTree() {
  const trackedFiles = runGit(['ls-files']).split('\n').filter(Boolean);
  const fileMap = new Map();

  for (const filePath of trackedFiles) {
    if (!isRelevantFile(filePath)) continue;

    const absolutePath = path.join(repoRoot, filePath);
    if (!fs.existsSync(absolutePath)) continue;

    const lines = fs.readFileSync(absolutePath, 'utf8').split('\n').map((text, index) => ({
      lineNumber: index + 1,
      text,
    }));

    fileMap.set(filePath, lines);
  }

  return fileMap;
}

function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

function checkLine(filePath, lineNumber, text) {
  const violations = [];
  const trimmed = text.trim();

  if (!trimmed || isCommentOnlyLine(trimmed)) {
    return violations;
  }

  const isWebviewSource = filePath.startsWith('webview-ui/src/');

  if (isWebviewSource) {
    for (const pattern of COLOR_LITERAL_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        violations.push({
          rule: 'centralize-colors',
          message: 'Use shared constants or `--pixel-*` tokens instead of inline color literals.',
          filePath,
          lineNumber,
          text: trimmed,
        });
        break;
      }
    }

    const hasBoxShadow = /\bboxShadow\b|\bbox-shadow\b/.test(text);
    if (hasBoxShadow && !text.includes('var(--pixel-shadow)') && !text.includes('2px 2px 0px')) {
      violations.push({
        rule: 'pixel-shadow',
        message: 'Use `var(--pixel-shadow)` or a hard offset `2px 2px 0px` shadow.',
        filePath,
        lineNumber,
        text: trimmed,
      });
    }

    const hasFontFamily = /\bfontFamily\b|\bfont-family\b/.test(text);
    if (hasFontFamily && !text.includes('FS Pixel Sans')) {
      violations.push({
        rule: 'pixel-font',
        message: 'Use the FS Pixel Sans font for UI styling.',
        filePath,
        lineNumber,
        text: trimmed,
      });
    }
  }

  if (filePath.startsWith('src/')) {
    for (const pattern of COLOR_LITERAL_PATTERNS) {
      if (pattern.test(text)) {
        violations.push({
          rule: 'centralize-colors',
          message: 'Keep color literals out of backend source files unless they are defined in shared constants.',
          filePath,
          lineNumber,
          text: trimmed,
        });
        break;
      }
    }
  }

  return violations;
}

function collectViolations(scanMode) {
  const sources =
    scanMode.mode === 'diff'
      ? parseDiff(runGit(scanMode.args))
      : collectFullTree();

  const relevantEntries = [...sources.entries()].filter(([filePath]) => isRelevantFile(filePath));
  const violations = [];

  for (const [filePath, lines] of relevantEntries) {
    for (const { lineNumber, text } of lines) {
      violations.push(...checkLine(filePath, lineNumber, text));
    }
  }

  return {
    filesScanned: relevantEntries.length,
    violations,
  };
}

function formatViolations(violations) {
  return violations
    .map(({ rule, filePath, lineNumber, message, text }) => `- \`${rule}\` [${filePath}:${lineNumber}] ${message}\n  \`${text}\``)
    .join('\n');
}

function main() {
  const scanMode = detectMode();
  const { filesScanned, violations } = collectViolations(scanMode);

  let output = `Contributors policy scan: ${scanMode.label}\n`;
  output += `Files scanned: ${filesScanned}\n`;

  if (violations.length === 0) {
    output += 'Result: PASS\n';
    console.log(output.trimEnd());

    writeSummary([
      '## Contributors Policy',
      '',
      `Mode: ${scanMode.label}`,
      '',
      `Files scanned: ${filesScanned}`,
      '',
      'Result: PASS',
    ].join('\n'));

    return;
  }

  output += `Result: FAIL (${violations.length} violation${violations.length === 1 ? '' : 's'})\n\n`;
  output += formatViolations(violations);
  console.error(output.trimEnd());

  writeSummary([
    '## Contributors Policy',
    '',
    `Mode: ${scanMode.label}`,
    '',
    `Files scanned: ${filesScanned}`,
    '',
    `Result: FAIL (${violations.length} violation${violations.length === 1 ? '' : 's'})`,
    '',
    formatViolations(violations),
  ].join('\n'));

  process.exitCode = 1;
}

main();
