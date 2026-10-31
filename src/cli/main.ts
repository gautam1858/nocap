import { version } from '../version.js';
import { resolveCommand, subcommandsOf } from './commands.js';
import { renderCommandHelp, renderGroupHelp, renderHelp } from './help.js';
import { ExitCode, type Io } from './io.js';

function isHelpFlag(arg: string | undefined): boolean {
  return arg === '-h' || arg === '--help';
}

function wantsHelp(args: readonly string[]): boolean {
  const end = args.indexOf('--');
  return (end === -1 ? args : args.slice(0, end)).some(isHelpFlag);
}

function usageError(io: Io, message: string): number {
  io.stderr.write(`nocap: ${message}\nRun 'nocap --help' to see available commands.\n`);
  return ExitCode.usage;
}

function help(topic: readonly string[], io: Io): number {
  if (topic.length === 0) {
    io.stdout.write(renderHelp());
    return ExitCode.ok;
  }
  const resolved = resolveCommand(topic);
  if (resolved?.rest.length === 0) {
    io.stdout.write(renderCommandHelp(resolved.command));
    return ExitCode.ok;
  }
  const group = topic.join(' ');
  const subcommands = subcommandsOf(group);
  if (subcommands.length > 0) {
    io.stdout.write(renderGroupHelp(group, subcommands));
    return ExitCode.ok;
  }
  return usageError(io, `no help for unknown command '${group}'`);
}

export async function run(argv: readonly string[], io: Io): Promise<number> {
  const [first, ...rest] = argv;

  if (first === undefined || isHelpFlag(first)) {
    io.stdout.write(renderHelp());
    return ExitCode.ok;
  }
  if (first === '-v' || first === '--version') {
    io.stdout.write(`${version}\n`);
    return ExitCode.ok;
  }
  if (first === 'help') return help(rest, io);
  if (first.startsWith('-')) return usageError(io, `unknown option '${first}'`);

  const resolved = resolveCommand(argv);
  if (!resolved) {
    const subcommands = subcommandsOf(first);
    if (subcommands.length === 0) return usageError(io, `unknown command '${first}'`);
    const [sub] = rest;
    if (isHelpFlag(sub)) {
      io.stdout.write(renderGroupHelp(first, subcommands));
      return ExitCode.ok;
    }
    io.stderr.write(
      sub === undefined
        ? `nocap ${first}: missing command.\n\n`
        : `nocap ${first}: unknown command '${sub}'.\n\n`,
    );
    io.stderr.write(renderGroupHelp(first, subcommands));
    return ExitCode.usage;
  }

  const { command, rest: args } = resolved;
  if (wantsHelp(args)) {
    io.stdout.write(renderCommandHelp(command));
    return ExitCode.ok;
  }
  if (!command.run) {
    io.stderr.write(`nocap ${command.name}: not implemented in version ${version}.\n`);
    return ExitCode.failure;
  }
  return await command.run(args, io);
}
