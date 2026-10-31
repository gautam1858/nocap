import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect } from 'vitest';
import '../../src/cli/suppress-warnings.js';
import { install, takeAttempts } from './network-tripwire.mjs';

install();

// No test may read the real agent logs or write a real ~/.nocap, even by accident.
const sandbox = mkdtempSync(join(tmpdir(), 'nocap-test-worker-'));
process.env.HOME = sandbox;
process.env.NOCAP_HOME = join(sandbox, '.nocap');
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;
// Output assertions expect plain text unless a test asks for colour.
delete process.env.FORCE_COLOR;
delete process.env.NO_COLOR;

afterEach(() => {
  expect(takeAttempts(), 'code under test attempted network access').toEqual([]);
});
