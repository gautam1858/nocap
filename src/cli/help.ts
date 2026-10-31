import { version } from '../version.js';
import { commands, type Command } from './commands.js';

type Rows = readonly (readonly [string, string])[];

function columnWidth(...tables: Rows[]): number {
  return Math.max(...tables.flat().map(([left]) => left.length)) + 3;
}

function table(rows: Rows, width = columnWidth(rows)): string {
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`).join('\n');
}

const globalOptions: Rows = [
  ['-h, --help', 'Show help for nocap or a command'],
  ['-v, --version', 'Print the version'],
];

export function renderHelp(): string {
  const commandRows: Rows = commands.map((c) => [c.name, c.summary]);
  const width = columnWidth(commandRows, globalOptions);
  return [
    `nocap ${version}: a local black box for coding agents`,
    'Your agent says the tests pass. nocap checks the receipts.',
    '',
    'Usage: nocap <command> [options]',
    '',
    'Commands:',
    table(commandRows, width),
    '',
    'Options:',
    table(globalOptions, width),
    '',
    "Run 'nocap help <command>' for details on a command.",
    'nocap runs entirely on this machine and never opens a network connection.',
    '',
  ].join('\n');
}

export function renderCommandHelp(command: Command): string {
  return [`Usage: ${command.usage}`, '', command.summary, ''].join('\n');
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
