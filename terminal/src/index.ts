#!/usr/bin/env node

import { TerminalRunner } from './runner.js';

const runner = new TerminalRunner();

process.on('SIGINT', () => {
  runner.stop();
  process.exit(0);
});

runner.start().catch((err: unknown) => {
  console.error('[pixel-agents-terminal] Fatal error:', err);
  process.exit(1);
});
