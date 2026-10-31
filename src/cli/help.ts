import { version } from '../version.js';
import { commands, type Command } from './commands.js';
import { plain, type Style } from './style.js';

type Rows = readonly (readonly [string, string])[];

function columnWidth(...tables: Rows[]): number {
  return Math.max(...tables.flat().map(([left]) => left.length)) + 3;
}

function table(rows: Rows, width = columnWidth(rows), style: Style = plain): string {
  return rows.map(([left, right]) => `  ${style.bold(left.padEnd(width))}${right}`).join('\n');
}

const globalOptions: Rows = [
  ['-h, --help', 'Show help for nocap or a command'],
  ['-v, --version', 'Print the version'],
];

export function renderHelp(style: Style = plain): string {
  const commandRows: Rows = commands.map((c) => [c.name, c.summary]);
  const width = columnWidth(commandRows, globalOptions);
  return [
    `${style.bold(style.accent(`nocap ${version}`))}: a local black box for coding agents`,
    style.dim('Your agent says the tests pass. nocap checks the receipts.'),
    '',
    `${style.bold('Usage:')} nocap <command> [options]`,
    '',
    style.bold('Commands:'),
    table(commandRows, width, style),
    '',
    style.bold('Options:'),
    table(globalOptions, width, style),
    '',
    "Run 'nocap help <command>' for details on a command.",
    style.dim('nocap runs entirely on this machine and never opens a network connection.'),
    '',
  ].join('\n');
}

export function renderCommandHelp(command: Command): string {
  const lines = [`Usage: ${command.usage}`, '', command.summary];
  if (command.details) lines.push('', command.details);
  if (command.options && command.options.length > 0)
    lines.push('', 'Options:', table(command.options));
  lines.push('');
  return lines.join('\n');
}

export function renderGroupHelp(group: string, subcommands: readonly Command[]): string {
  return [
    `Usage: nocap ${group} <command>`,
    '',
    'Commands:',
    table(subcommands.map((c) => [c.name.slice(group.length + 1), c.summary])),
    '',
  ].join('\n');
}
