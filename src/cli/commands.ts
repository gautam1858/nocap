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
    options: [
      ['[session]', 'A session id or unique prefix; defaults to the most recent'],
      ['--light, --dark', 'Theme (default dark)'],
      ['--share', 'Also write a PNG and a ready-to-post one-liner'],
      ['--png, --html', 'Also write a PNG / HTML copy'],
      ['--out <path>', 'Write to this path instead of ./<docket>.svg'],
    ],
    details:
      'Writes a self-contained SVG card (no fonts, scripts or network). PNG needs\n' +
      'rsvg-convert, resvg or Chrome/Chromium installed; without one, the SVG is\n' +
      'still written. The card carries no prompt text, file contents or home paths.',
    run: async (args, io) => await (await import('./commands/card.js')).cardCommand(args, io),
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
    usage: 'nocap guard install [--project] [--dry-run]',
    options: [
      ['--project', 'Install into the project .claude/settings.json instead of the user one'],
      ['--dry-run', 'Show what would change without writing'],
    ],
    details:
      'Adds a fail-closed PreToolUse/UserPromptSubmit hook that blocks destructive\n' +
      'commands, runaway loops, subagent fan-out and dead-man conditions, and logs\n' +
      'every trip as a near miss. Existing hooks are kept; a backup is written.',
    run: async (args, io) => (await import('./commands/guard.js')).guardInstall(args, io),
  },
  {
    name: 'guard uninstall',
    summary: 'Remove the guard hook from agent settings',
    usage: 'nocap guard uninstall [--project] [--dry-run]',
    options: [
      ['--project', 'Remove from the project settings instead of the user one'],
      ['--dry-run', 'Show what would change without writing'],
    ],
    run: async (args, io) => (await import('./commands/guard.js')).guardUninstall(args, io),
  },
  {
    name: 'guard status',
    summary: 'Show whether the guard is installed and recent near misses',
    usage: 'nocap guard status',
    run: async (args, io) => (await import('./commands/guard.js')).guardStatus(args, io),
  },
  {
    name: 'wrapped',
    summary: 'Summarise a week, month or year of agent sessions',
    usage: 'nocap wrapped [week|month|year|all] [--json]',
    options: [['--json', 'Print the summary as JSON']],
    details:
      'Totals flights, spend, claims audited and caught, testwash and near misses across a period.',
    run: async (args, io) => (await import('./commands/wrapped.js')).wrappedCommand(args, io),
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
