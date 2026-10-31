import type { Io } from './io.js';

export interface Command {
  /** Space-separated path, e.g. "guard install". */
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  readonly options?: readonly (readonly [string, string])[];
  readonly details?: string;
  readonly run?: (args: readonly string[], io: Io) => Promise<number> | number;
}

export const commands: readonly Command[] = [
  {
    name: 'archive',
    summary: 'Copy agent session logs into the local archive before they expire',
    usage: 'nocap archive [options]',
    options: [
      ['--agent <id>', 'Only this agent: claude-code or codex (repeatable)'],
      ['--dry-run', 'Read and redact everything, write nothing'],
      ['--json', 'Print the summary as JSON'],
    ],
    details:
      'Copies each session log into ~/.nocap/archive (or $NOCAP_HOME) with secrets\n' +
      'redacted, then indexes it. Agent directories are only ever read.',
    run: async (args, io) => (await import('./commands/archive.js')).archiveCommand(args, io),
  },
  {
    name: 'audit',
    summary: "Check an agent's claims against what it actually did",
    usage: 'nocap audit [session] [options]',
    options: [
      ['[session]', 'A session id or a unique prefix; defaults to the most recent'],
      ['--all', 'Audit every indexed session'],
      ['--json', 'Print the analysis as JSON'],
    ],
    details:
      'Extracts claims (tests pass, done, didn’t touch X) and checks each against\n' +
      'the evidence: last test run, exit code, scope, and edits since. Exits 1 when\n' +
      'it finds a contradicted or stale claim, test tampering, or a near miss.',
    run: async (args, io) => (await import('./commands/audit.js')).auditCommand(args, io),
  },
  {
    name: 'card',
    summary: 'Render a Probable Cause card for a session',
    usage: 'nocap card [session] [options]',
  },
  {
    name: 'doctor',
    summary: 'Report agent versions, adapter coverage and unknown event types',
    usage: 'nocap doctor [--json]',
    options: [['--json', 'Print the report as JSON']],
    details: 'Reads every session log in memory and writes nothing. Exits 1 if it finds problems.',
    run: async (args, io) => (await import('./commands/doctor.js')).doctorCommand(args, io),
  },
  {
    name: 'guard install',
    summary: 'Install the guard hook into agent settings, keeping a backup',
    usage: 'nocap guard install [options]',
  },
  {
    name: 'guard uninstall',
    summary: 'Remove the guard hook from agent settings',
    usage: 'nocap guard uninstall [options]',
  },
  {
    name: 'wrapped',
    summary: 'Summarise a week, month or year of agent sessions',
    usage: 'nocap wrapped [week|month|year]',
  },
];

export interface Resolved {
  readonly command: Command;
  readonly rest: readonly string[];
}

/** Longest command path that prefixes argv wins, so "guard install" beats "guard". */
export function resolveCommand(argv: readonly string[]): Resolved | undefined {
  let best: Resolved | undefined;
  for (const command of commands) {
    const parts = command.name.split(' ');
    const matches = parts.every((part, i) => argv[i] === part);
    if (matches && parts.length > (best?.command.name.split(' ').length ?? 0)) {
      best = { command, rest: argv.slice(parts.length) };
    }
  }
  return best;
}

/** Commands under a group such as "guard", used when the subcommand is missing or unknown. */
export function subcommandsOf(group: string): readonly Command[] {
  return commands.filter((c) => c.name.startsWith(`${group} `));
}
