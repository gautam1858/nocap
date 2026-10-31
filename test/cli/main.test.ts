import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commands, resolveCommand } from '../../src/cli/commands.js';
import { run } from '../../src/cli/main.js';

async function invoke(...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const status = await run(argv, {
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  });
  return { status, stdout, stderr };
}

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

describe('nocap CLI', () => {
  it.each([{ argv: [] }, { argv: ['--help'] }, { argv: ['-h'] }, { argv: ['help'] }])(
    'prints help for $argv',
    async ({ argv }) => {
      const result = await invoke(...argv);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: nocap <command> [options]');
      expect(result.stderr).toBe('');
    },
  );

  it('lists every command in the help', async () => {
    const { stdout } = await invoke('--help');
    for (const command of commands) expect(stdout).toContain(command.name);
  });

  it('states that it stays offline', async () => {
    const { stdout } = await invoke('--help');
    expect(stdout).toContain('never opens a network connection');
  });

  it.each([['--version'], ['-v']])('prints the package version for %s', async (flag) => {
    const result = await invoke(flag);
    expect(result).toEqual({ status: 0, stdout: `${pkg.version}\n`, stderr: '' });
  });

  describe.each(commands.map((c) => [c.name, c] as const))('%s', (name, command) => {
    const path = name.split(' ');

    it('shows usage with --help', async () => {
      const result = await invoke(...path, '--help');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Usage: ${command.usage}`);
    });

    it('shows usage via nocap help', async () => {
      const result = await invoke('help', ...path);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`Usage: ${command.usage}`);
    });

    it.runIf(command.run === undefined)('reports that it is not implemented', async () => {
      const result = await invoke(...path);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('not implemented');
    });
  });

  it('does not treat --help after -- as a help request', async () => {
    const result = await invoke('archive', '--', '--help');
    expect(result.stdout).toBe('');
    expect(result.status).toBe(1);
  });

  it('rejects an unknown command with a usage error', async () => {
    const result = await invoke('takeoff');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown command 'takeoff'");
    expect(result.stderr).toContain('nocap --help');
  });

  it('rejects an unknown option with a usage error', async () => {
    const result = await invoke('--yolo');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown option '--yolo'");
  });

  it('rejects help for an unknown command', async () => {
    const result = await invoke('help', 'takeoff');
    expect(result.status).toBe(2);
  });

  describe('command groups', () => {
    it('lists subcommands when the subcommand is missing', async () => {
      const result = await invoke('guard');
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('missing command');
      expect(result.stderr).toContain('install');
      expect(result.stderr).toContain('uninstall');
    });

    it('rejects an unknown subcommand', async () => {
      const result = await invoke('guard', 'disable');
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("unknown command 'disable'");
    });

    it.each([{ argv: ['guard', '--help'] }, { argv: ['help', 'guard'] }])(
      'prints group help for $argv',
      async ({ argv }) => {
        const result = await invoke(...argv);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('Usage: nocap guard <command>');
      },
    );
  });
});

describe('resolveCommand', () => {
  it('prefers the longest matching command path', () => {
    expect(resolveCommand(['guard', 'install', '--dry-run'])).toMatchObject({
      command: { name: 'guard install' },
      rest: ['--dry-run'],
    });
  });

  it('returns undefined for a bare group', () => {
    expect(resolveCommand(['guard'])).toBeUndefined();
  });
});
