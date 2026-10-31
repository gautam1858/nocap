import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { loadConfig } from '../../guard/config.js';
import {
  hookCommand,
  installGuard,
  isInstalled,
  uninstallGuard,
  type InstallResult,
  type UninstallResult,
} from '../../guard/install.js';
import { readNearMisses } from '../../guard/nearmiss.js';
import type { GuardEnv } from '../../guard/paths.js';
import { plural } from '../format.js';
import { ExitCode, type Io } from '../io.js';
import { field, styleFor, type Style } from '../style.js';

function guardEnv(): GuardEnv {
  return { home: process.env.HOME ?? homedir(), env: process.env };
}

function parse(
  command: string,
  args: readonly string[],
  io: Io,
): { scope: 'user' | 'project'; dryRun: boolean } | number {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: { project: { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
      strict: true,
    });
    return { scope: values.project ? 'project' : 'user', dryRun: values['dry-run'] === true };
  } catch (error) {
    io.stderr.write(
      `nocap ${command}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return ExitCode.usage;
  }
}

function home(path: string, h: string): string {
  return path.startsWith(h) ? `~${path.slice(h.length)}` : path;
}

function renderInstall(result: InstallResult, style: Style, dryRun: boolean, h: string): string {
  const out: string[] = [];
  out.push(style.bold(style.accent(dryRun ? 'Guard install (dry run)' : 'Guard installed')));
  out.push(field(style, 'settings', home(result.path, h)));
  out.push(field(style, 'hooks', result.events.join(', ')));
  out.push(field(style, 'command', style.dim(hookCommand())));
  if (result.backup) out.push(field(style, 'backup', home(result.backup, h)));
  else if (!dryRun)
    out.push(field(style, 'backup', style.dim('none needed (settings.json was created)')));
  out.push('');
  out.push(
    style.dim('The guard runs on every tool call (logic <1ms; Node adds its usual startup).'),
  );
  out.push(style.dim('Turn it off any time with NOCAP_GUARD_OFF=1, or `nocap guard uninstall`.'));
  out.push(style.dim('Codex: point a PreToolUse hook at the same command above; see the README.'));
  return `${out.join('\n')}\n`;
}

export function guardInstall(args: readonly string[], io: Io): number {
  const parsed = parse('guard install', args, io);
  if (typeof parsed === 'number') return parsed;
  const e = guardEnv();
  const result = installGuard(e, parsed.scope, parsed.dryRun);
  io.stdout.write(renderInstall(result, styleFor(io.stdout), parsed.dryRun, e.home));
  return ExitCode.ok;
}

function renderUninstall(
  result: UninstallResult,
  style: Style,
  dryRun: boolean,
  h: string,
): string {
  if (result.removed === 0) {
    return `${style.dim(`No nocap guard hooks found in ${home(result.path, h)}.`)}\n`;
  }
  const out = [
    style.bold(dryRun ? 'Guard uninstall (dry run)' : 'Guard removed'),
    field(style, 'settings', home(result.path, h)),
    field(style, 'removed', plural(result.removed, 'hook entry', 'hook entries')),
  ];
  if (result.backup) out.push(field(style, 'backup', home(result.backup, h)));
  return `${out.join('\n')}\n`;
}

export function guardUninstall(args: readonly string[], io: Io): number {
  const parsed = parse('guard uninstall', args, io);
  if (typeof parsed === 'number') return parsed;
  const e = guardEnv();
  const result = uninstallGuard(e, parsed.scope, parsed.dryRun);
  io.stdout.write(renderUninstall(result, styleFor(io.stdout), parsed.dryRun, e.home));
  return ExitCode.ok;
}

export function guardStatus(args: readonly string[], io: Io): number {
  try {
    parseArgs({ args: [...args], options: {}, strict: true });
  } catch (error) {
    io.stderr.write(
      `nocap guard status: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return ExitCode.usage;
  }
  const e = guardEnv();
  const style = styleFor(io.stdout);
  const config = loadConfig(e.home, e.env);
  const misses = readNearMisses(e);
  const out: string[] = [];
  out.push(style.bold(style.accent('Guard status')));
  out.push(
    field(
      style,
      'installed',
      isInstalled(e, 'user')
        ? style.green('yes (user settings)')
        : isInstalled(e, 'project')
          ? style.green('yes (project settings)')
          : style.dim("no — run 'nocap guard install'"),
    ),
  );
  out.push(
    field(
      style,
      'rules',
      config.disabled
        ? style.yellow('disabled')
        : `loop ≥${String(config.loopRepeats)} · fan-out ≥${String(config.subagentFanout)} · dead-man ${String(config.deadMansSwitchMinutes)}m · ${config.rateCalls > 0 ? `${String(config.rateCalls)}/${String(config.rateWindowSec)}s` : 'rate off'}`,
    ),
  );
  out.push(
    field(
      style,
      'misses',
      misses.length === 0
        ? style.dim('none logged')
        : style.yellow(plural(misses.length, 'near miss', 'near misses')),
    ),
  );
  for (const m of misses.slice(-5)) {
    out.push(`  ${style.yellow('⚠')} ${style.dim(m.ts.slice(0, 19))}  ${m.rule}`.slice(0, 140));
  }
  io.stdout.write(`${out.join('\n')}\n`);
  return ExitCode.ok;
}
