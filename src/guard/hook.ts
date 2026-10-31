#!/usr/bin/env node
// Fast, self-contained PreToolUse / UserPromptSubmit hook entry for Claude Code
// and Codex. Reads the hook JSON on stdin, decides, and exits 0 (allow) or 2
// (block). It imports only guard code, so it starts well under the hot-path
// budget. See src/guard/run.ts for the decision logic.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runGuard } from './run.js';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const outcome = runGuard(readStdin(), { home: process.env.HOME ?? homedir(), env: process.env });
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exit(outcome.exitCode);
