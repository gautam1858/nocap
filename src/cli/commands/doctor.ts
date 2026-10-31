import { parseArgs } from 'node:util';
import { currentEnvironment } from '../../core/paths.js';
import { runDoctor, type DoctorReport } from '../../doctor/doctor.js';
import { version } from '../../version.js';
import { bytes, count, plural, sum, tally } from '../format.js';
import { ExitCode, type Io } from '../io.js';
import { field, plain, styleFor, type Style } from '../style.js';

export function renderDoctor(report: DoctorReport, style: Style = plain): string {
  const out: string[] = [];
  out.push(
    `${style.bold(`nocap ${version}`)} ${style.dim(`on node ${report.node} (${report.platform})`)}`,
  );
  out.push(field(style, 'home', report.nocapHome));
  if (report.index) {
    const i = report.index;
    out.push(
      field(
        style,
        'index',
        `${plural(i.sources, 'file')}, ${plural(i.events, 'event')}, ${plural(i.sessions, 'session')}` +
          (i.stale > 0
            ? style.yellow(
                ` (${count(i.stale)} indexed by an older nocap; 'nocap archive' refreshes them)`,
              )
            : ''),
      ),
    );
  } else {
    out.push(field(style, 'index', style.dim("not created yet; run 'nocap archive'")));
  }

  for (const a of report.agents) {
    out.push('', style.bold(style.accent(a.name)));
    const present = a.roots.filter((r) => r.exists);
    out.push(
      field(
        style,
        'logs',
        present.length > 0
          ? present.map((r) => r.path).join(', ')
          : style.dim(`none found (looked in ${a.roots.map((r) => r.path).join(', ')})`),
      ),
    );
    out.push(
      field(
        style,
        'installed',
        a.installed
          ? `${a.installed.path}${a.installed.version ? `, version ${a.installed.version}` : style.dim(', version unknown')}`
          : style.dim('not found on PATH'),
      ),
    );
    if (a.files === 0) continue;
    const versions = [...a.versions.entries()].sort((x, y) => y[1] - x[1]);
    out.push(
      field(
        style,
        'versions',
        versions.length > 0
          ? versions.map(([v, n]) => `${v} ${style.dim(`(${plural(n, 'session')})`)}`).join(', ')
          : style.dim('none recorded in the logs'),
      ),
    );
    out.push(field(style, 'sessions', `${plural(a.files, 'file')}, ${bytes(a.bytes)}`));
    if (a.retentionDays) {
      out.push(
        field(
          style,
          'retention',
          `${a.name} deletes logs after ${String(a.retentionDays.value)} days ${style.dim(`(cleanupPeriodDays, ${a.retentionDays.source === 'default' ? 'default' : 'from settings.json'})`)}`,
        ),
      );
    }
    const archived = `${count(a.archived)} of ${count(a.files)}`;
    out.push(
      field(
        style,
        'archived',
        a.archived === a.files ? style.green(archived) : style.yellow(archived),
      ),
    );
    const clean = a.parseErrors === 0 && a.unknown.size === 0;
    const coverage = `${count(a.parseErrors)} unparseable, ${plural(a.unknown.size, 'unrecognised record type')}`;
    out.push(
      field(
        style,
        'coverage',
        `${plural(a.lines, 'line')} read, ${plural(a.events, 'event')}, ${clean ? style.green(coverage) : style.yellow(coverage)}`,
      ),
    );
    for (const [type, seen] of a.unknown) {
      out.push(
        `              ${style.yellow(`${type} x${count(seen.count)}`)} ${style.dim(`(first at ${seen.example})`)}`,
      );
    }
    const secrets = sum(a.redactions);
    out.push(
      field(
        style,
        'redaction',
        secrets === 0
          ? style.dim('no secrets found')
          : `${style.yellow(plural(secrets, 'secret'))} would be redacted ${style.dim(`(${tally(a.redactions)})`)}`,
      ),
    );
  }

  out.push('');
  if (report.problems.length === 0) out.push(style.bold(style.green('No problems found.')));
  else {
    out.push(style.bold(style.red('Problems')));
    for (const problem of report.problems) out.push(`  ${style.red('-')} ${problem}`);
  }
  return `${out.join('\n')}\n`;
}

export function doctorCommand(args: readonly string[], io: Io): number {
  let values: { json?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: { json: { type: 'boolean' } },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`nocap doctor: ${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.usage;
  }
  const report = runDoctor(currentEnvironment());
  if (values.json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ...report,
          agents: report.agents.map((a) => ({
            ...a,
            versions: Object.fromEntries(a.versions),
            unknown: Object.fromEntries(a.unknown),
            redactions: Object.fromEntries(a.redactions),
          })),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    io.stdout.write(renderDoctor(report, styleFor(io.stdout)));
  }
  return report.problems.length === 0 ? ExitCode.ok : ExitCode.failure;
}
