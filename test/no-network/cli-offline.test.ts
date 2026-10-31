import { describe, expect, it } from 'vitest';
import { commands } from '../../src/cli/commands.js';
import { runCli } from '../support/cli.js';
import { TRIPWIRE_EXIT_CODE, TRIPWIRE_MARKER } from '../support/network-tripwire.mjs';

// Every command path is generated from the registry, so a new command is
// covered here without anyone remembering to add it.
const groups = [
  ...new Set(commands.filter((c) => c.name.includes(' ')).map((c) => c.name.split(' ')[0])),
];
const invocations: string[][] = [
  [],
  ['--help'],
  ['--version'],
  ['help'],
  ['--unknown-flag'],
  ['unknown-command'],
  ...groups.flatMap((group) => (group ? [[group], [group, '--help'], [group, 'unknown']] : [])),
  ...commands.flatMap((command) => {
    const path = command.name.split(' ');
    return [path, [...path, '--help'], ['help', ...path]];
  }),
];

describe('the built CLI never touches the network', () => {
  it.each(invocations.map((argv) => ({ argv, label: argv.join(' ') || '(no arguments)' })))(
    'nocap $label',
    ({ argv }) => {
      const result = runCli(argv);
      expect(result.stderr).not.toContain(TRIPWIRE_MARKER);
      expect(result.status).not.toBe(TRIPWIRE_EXIT_CODE);
      expect(result.status).not.toBeNull();
    },
  );
});
