import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const binPath = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
export const tripwirePreload = new URL('./network-tripwire.preload.mjs', import.meta.url).href;

export interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function toResult(result: SpawnSyncReturns<string>): CliResult {
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Node with the network tripwire preloaded. */
export function runNode(args: readonly string[], env: NodeJS.ProcessEnv = {}): CliResult {
  return toResult(
    spawnSync(process.execPath, ['--import', tripwirePreload, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 30_000,
    }),
  );
}

/**
 * Runs the built CLI with the network tripwire preloaded and a throwaway home
 * directory, so commands never see the real agent logs on the test machine.
 */
export function runCli(args: readonly string[], options: { home?: string } = {}): CliResult {
  const home = options.home ?? mkdtempSync(join(tmpdir(), 'nocap-test-home-'));
  try {
    return runNode([binPath, ...args], {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
      NOCAP_HOME: join(home, '.nocap'),
    });
  } finally {
    if (options.home === undefined) rmSync(home, { recursive: true, force: true });
  }
}
