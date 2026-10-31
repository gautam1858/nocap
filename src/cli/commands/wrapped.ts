import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import { analyze } from '../../analyzers/analyze.js';
import { currentEnvironment, databasePath } from '../../core/paths.js';
import { nearMissesForSession } from '../../guard/nearmiss.js';
import { summarise, type Period, type Wrapped } from '../../report/wrapped.js';
import { sessionInfoFromRow, Store } from '../../store/store.js';
import { count, duration, plural } from '../format.js';
import { ExitCode, type Io } from '../io.js';
import { field, plain, styleFor, type Style } from '../style.js';

const PERIODS: readonly Period[] = ['week', 'month', 'year', 'all'];

export function renderWrapped(w: Wrapped, style: Style = plain): string {
  const label =
    w.period === 'all'
      ? 'all time'
      : `the last ${w.period === 'week' ? '7 days' : w.period === 'month' ? '30 days' : 'year'}`;
  const out: string[] = [];
  out.push(`${style.bold(style.accent('nocap wrapped'))} ${style.dim(`· ${label}`)}`);
  out.push('');
  if (w.sessions === 0) {
    out.push(style.dim('No sessions in this period. Run `nocap archive` to pull some in.'));
    return `${out.join('\n')}\n`;
  }
  out.push(
    field(
      style,
      'flights',
      `${plural(w.sessions, 'session')}, ${duration(w.durationMs)} in the cockpit`,
    ),
  );
  out.push(
    field(
      style,
      'spend',
      w.usdKnown
        ? `$${w.usd.toFixed(2)} ${style.dim('(where the agent recorded it)')}`
        : style.dim('not recorded by the agent'),
    ),
  );
  out.push(
    field(
      style,
      'tools',
      `${count(w.toolCalls)} fired across ${plural(w.filesTouched, 'file touched', 'files touched')}`,
    ),
  );
  out.push('');
  out.push(
    field(
      style,
      'claims',
      `${count(w.claimsAudited)} audited · ${style.green(`${String(w.backed)} backed`)} · ${style.yellow(`${String(w.narrowed + w.stale)} soft`)} · ${style.red(`${String(w.contradicted)} contradicted`)}`,
    ),
  );
  const caught =
    w.liesCaught > 0
      ? style.red(plural(w.liesCaught, 'thing the agent glossed over'))
      : style.green('nothing the agent glossed over');
  out.push(field(style, 'caught', caught));
  out.push(
    field(
      style,
      'testwash',
      w.testwash > 0
        ? style.red(plural(w.testwash, 'test weakened after a failure'))
        : style.dim('none'),
    ),
  );
  out.push(
    field(
      style,
      'misses',
      w.nearMisses > 0
        ? style.yellow(plural(w.nearMisses, 'near miss', 'near misses'))
        : style.dim('none'),
    ),
  );
  if (w.busiestDay)
    out.push(
      field(style, 'busiest', `${w.busiestDay.date} (${plural(w.busiestDay.sessions, 'session')})`),
    );
  if (w.worstCauses.length > 0) {
    out.push('');
    out.push(style.dim('Headlines:'));
    for (const cause of w.worstCauses) out.push(`  ${style.accent('•')} ${cause}`);
  }
  return `${out.join('\n')}\n`;
}

export function wrappedCommand(args: readonly string[], io: Io): number {
  let values: { json?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...args],
      options: { json: { type: 'boolean' } },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`nocap wrapped: ${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.usage;
  }
  const period = (positionals[0] ?? 'month') as Period;
  if (!PERIODS.includes(period)) {
    io.stderr.write(
      `nocap wrapped: unknown period '${String(positionals[0])}'. Expected one of: ${PERIODS.join(', ')}.\n`,
    );
    return ExitCode.usage;
  }

  const environment = currentEnvironment();
  const dbPath = databasePath(environment);
  if (!existsSync(dbPath)) {
    io.stderr.write("nocap wrapped: no index yet. Run 'nocap archive' first.\n");
    return ExitCode.failure;
  }
  const store = Store.open(dbPath);
  try {
    const guardEnv = { home: process.env.HOME ?? homedir(), env: process.env };
    const analyses = store
      .sessions()
      .map((row) =>
        analyze(
          sessionInfoFromRow(row),
          store.eventsForSession(row.agent, row.id),
          nearMissesForSession(guardEnv, row.id).length,
        ),
      );
    const w = summarise(analyses, period);
    io.stdout.write(
      values.json ? `${JSON.stringify(w, null, 2)}\n` : renderWrapped(w, styleFor(io.stdout)),
    );
    return ExitCode.ok;
  } finally {
    store.close();
  }
}
