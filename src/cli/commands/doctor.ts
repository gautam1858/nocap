import { parseArgs } from 'node:util';
import { currentEnvironment } from '../../core/paths.js';
import { runDoctor, type DoctorReport } from '../../doctor/doctor.js';
import { version } from '../../version.js';
import { bytes, count, plural, sum, tally } from '../format.js';
import { ExitCode, type Io } from '../io.js';

export function renderDoctor(report: DoctorReport): string {
  const out: string[] = [];
  out.push(`nocap ${version} on node ${report.node} (${report.platform})`);
  out.push(`  home      ${report.nocapHome}`);
  if (report.index) {
    const i = report.index;
    out.push(
      `  index     ${plural(i.sources, 'file')}, ${plural(i.events, 'event')}, ${plural(i.sessions, 'session')}` +
        (i.stale > 0
          ? ` (${count(i.stale)} indexed by an older nocap; 'nocap archive' refreshes them)`
          : ''),
    );
  } else {
    out.push("  index     not created yet; run 'nocap archive'");
  }

  for (const a of report.agents) {
    out.push('', a.name);
    const present = a.roots.filter((r) => r.exists);
    out.push(
      `  logs      ${present.length > 0 ? present.map((r) => r.path).join(', ') : `none found (looked in ${a.roots.map((r) => r.path).join(', ')})`}`,
    );
    out.push(
      `  installed ${a.installed ? `${a.installed.path}${a.installed.version ? `, version ${a.installed.version}` : ', version unknown'}` : 'not found on PATH'}`,
    );
    if (a.files === 0) continue;
    const versions = [...a.versions.entries()].sort((x, y) => y[1] - x[1]);
    out.push(
      `  versions  ${versions.length > 0 ? versions.map(([v, n]) => `${v} (${plural(n, 'session')})`).join(', ') : 'none recorded in the logs'}`,
    );
    out.push(`  sessions  ${plural(a.files, 'file')}, ${bytes(a.bytes)}`);
    if (a.retentionDays) {
      out.push(
        `  retention ${a.name} deletes logs after ${String(a.retentionDays.value)} days (cleanupPeriodDays, ${a.retentionDays.source === 'default' ? 'default' : 'from settings.json'})`,
      );
    }
    out.push(`  archived  ${count(a.archived)} of ${count(a.files)}`);
    out.push(
      `  coverage  ${plural(a.lines, 'line')} read, ${plural(a.events, 'event')}, ${count(a.parseErrors)} unparseable, ${plural(a.unknown.size, 'unrecognised record type')}`,
    );
    for (const [type, seen] of a.unknown) {
      out.push(`              ${type} x${count(seen.count)} (first at ${seen.example})`);
    }
    const secrets = sum(a.redactions);
    out.push(
      `  redaction ${secrets === 0 ? 'no secrets found' : `${plural(secrets, 'secret')} would be redacted (${tally(a.redactions)})`}`,
    );
  }

  out.push('');
  if (report.problems.length === 0) out.push('No problems found.');
  else {
    out.push('Problems');
    for (const problem of report.problems) out.push(`  - ${problem}`);
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
    io.stdout.write(renderDoctor(report));
  }
  return report.problems.length === 0 ? ExitCode.ok : ExitCode.failure;
}
