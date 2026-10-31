import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { runGuard } from '../../guard/run.js';
import { ExitCode, type Io } from '../io.js';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** The guard as a CLI subcommand, so a plugin can call `npx nocap guard run`. */
export function guardRunCommand(_args: readonly string[], io: Io): number {
  const outcome = runGuard(readStdin(), { home: process.env.HOME ?? homedir(), env: process.env });
  if (outcome.stdout) io.stdout.write(outcome.stdout);
  if (outcome.stderr) io.stderr.write(outcome.stderr);
  return outcome.exitCode === 2 ? ExitCode.usage : ExitCode.ok;
}
