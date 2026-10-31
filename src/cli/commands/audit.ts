import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { analyze, type SessionAnalysis } from '../../analyzers/analyze.js';
import type { Verdict } from '../../analyzers/polygraph.js';
import { homedir } from 'node:os';
import { currentEnvironment } from '../../core/paths.js';
import { databasePath } from '../../core/paths.js';
import { nearMissesForSession } from '../../guard/nearmiss.js';
import { sessionInfoFromRow, Store, type SessionRow } from '../../store/store.js';
import { clockTime, count, duration, plural } from '../format.js';
import { ExitCode, type Io } from '../io.js';
import { field, plain, styleFor, type Style } from '../style.js';

const VERDICT_LABEL: Record<Verdict, string> = {
  BACKED: 'BACKED',
  STALE: 'STALE',
  NARROWED: 'NARROWED',
  NO_EVIDENCE: 'NO EVIDENCE',
  CONTRADICTED: 'CONTRADICTED',
};

function colourVerdict(style: Style, verdict: Verdict): string {
  const label = VERDICT_LABEL[verdict];
  switch (verdict) {
    case 'BACKED':
      return style.green(label);
    case 'CONTRADICTED':
      return style.red(label);
    case 'STALE':
    case 'NARROWED':
      return style.yellow(label);
    case 'NO_EVIDENCE':
      return style.dim(label);
  }
}

export function renderAnalysis(a: SessionAnalysis, style: Style = plain): string {
  const out: string[] = [];
  const s = a.session;
  out.push(
    `${style.bold(style.accent(`${s.agent} · ${s.id.slice(0, 8)}`))}${s.model ? style.dim(`  ${s.model}`) : ''}`,
  );
  const when = s.startedAt
    ? `${clockTime(s.startedAt)}${s.endedAt ? ` → ${clockTime(s.endedAt)}` : ''}`
    : 'unknown';
  out.push(
    field(
      style,
      'flight',
      `${a.stats.durationMs !== undefined ? duration(a.stats.durationMs) : 'unknown'} ${style.dim(`(${when})`)}`,
    ),
  );
  const cost =
    a.stats.usd !== undefined
      ? `$${a.stats.usd.toFixed(2)}`
      : style.dim('not recorded by the agent');
  out.push(field(style, 'cost', cost));
  const cats = Object.entries(a.stats.byCategory)
    .sort((x, y) => y[1] - x[1])
    .map(([c, n]) => `${c} ${String(n)}`);
  out.push(
    field(
      style,
      'tools',
      `${count(a.stats.toolCalls)} fired${cats.length > 0 ? style.dim(`  (${cats.join(' · ')})`) : ''}`,
    ),
  );
  out.push(
    field(
      style,
      'files',
      a.stats.filesTouched.length > 0
        ? `${plural(a.stats.filesTouched.length, 'file')} touched ${style.dim(a.stats.filesTouched.slice(0, 4).join(' · ') + (a.stats.filesTouched.length > 4 ? ' …' : ''))}`
        : style.dim('none'),
    ),
  );

  const v = a.verdicts;
  out.push('');
  out.push(
    field(
      style,
      'claims',
      `${count(a.claims.length)} audited · ${style.green(`${String(v.BACKED)} backed`)} · ${style.yellow(`${String(v.STALE + v.NARROWED)} soft`)} · ${style.red(`${String(v.CONTRADICTED)} contradicted`)} · ${style.dim(`${String(v.NO_EVIDENCE)} no evidence`)}`,
    ),
  );
  // Lead with the claims that have a verdict; a wall of "no evidence" is noise.
  const shown = a.claims.filter((c) => c.verdict !== 'NO_EVIDENCE');
  for (const claim of shown) {
    out.push(
      `  ${colourVerdict(style, claim.verdict)}  ${style.dim(clockTime(claim.ts))}  ${truncate(claim.sentence, 72)}${claim.sidechain ? style.dim(' [subagent]') : ''}`,
    );
    for (const e of claim.evidence) out.push(`         ${style.dim('↳ ' + e.text)}`);
  }
  if (shown.length === 0 && a.claims.length > 0) {
    out.push(
      `  ${style.dim(`${plural(a.claims.length, 'claim')}, none with evidence either way`)}`,
    );
  }

  out.push('');
  out.push(field(style, 'integrity', gradeText(style, a.integrity)));
  if (a.testwash.length > 0) {
    for (const w of a.testwash) {
      out.push(
        `  ${style.yellow('⚠')} ${w.detail} ${style.dim(`(${w.path}${w.afterFailingRun ? ', after a failing run' : ''})`)}`,
      );
    }
  }
  out.push(
    field(
      style,
      'near miss',
      a.nearMisses > 0
        ? style.yellow(plural(a.nearMisses, 'near miss', 'near misses'))
        : style.dim('0 (guard not installed or none)'),
    ),
  );

  out.push('');
  out.push(`${style.bold(style.accent('PROBABLE CAUSE:'))} ${style.bold(a.probableCause)}`);
  return `${out.join('\n')}\n`;
}

function gradeText(style: Style, grade: SessionAnalysis['integrity']): string {
  const paint = (text: string): string =>
    grade === 'A' || grade === 'B'
      ? style.green(text)
      : grade === 'C'
        ? style.yellow(text)
        : style.red(text);
  return `test integrity ${paint(style.bold(grade))}`;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function resolve(store: Store, selector: string | undefined): SessionRow[] | { error: string } {
  const sessions = store.sessions();
  if (sessions.length === 0)
    return { error: "no sessions indexed yet. Run 'nocap archive' first." };
  if (selector === undefined) return sessions[0] ? [sessions[0]] : [];
  const matches = sessions.filter((s) => s.id === selector || s.id.startsWith(selector));
  if (matches.length === 0) return { error: `no session matches '${selector}'.` };
  if (matches.length > 1 && !matches.some((m) => m.id === selector)) {
    return {
      error: `'${selector}' matches ${String(matches.length)} sessions; use more of the id.`,
    };
  }
  return matches.some((m) => m.id === selector)
    ? matches.filter((m) => m.id === selector)
    : matches;
}

export function auditCommand(args: readonly string[], io: Io): number {
  let values: { all?: boolean; json?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...args],
      options: { all: { type: 'boolean' }, json: { type: 'boolean' } },
      allowPositionals: true,
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`nocap audit: ${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.usage;
  }

  const environment = currentEnvironment();
  const dbPath = databasePath(environment);
  if (!existsSync(dbPath)) {
    io.stderr.write("nocap audit: no index yet. Run 'nocap archive' first.\n");
    return ExitCode.failure;
  }
  const store = Store.open(dbPath);
  try {
    const selected = values.all ? store.sessions() : resolve(store, positionals[0]);
    if (!Array.isArray(selected)) {
      io.stderr.write(`nocap audit: ${selected.error}\n`);
      return ExitCode.failure;
    }
    const guardEnv = { home: process.env.HOME ?? homedir(), env: process.env };
    const analyses = selected.map((row) =>
      analyze(
        sessionInfoFromRow(row),
        store.eventsForSession(row.agent, row.id),
        nearMissesForSession(guardEnv, row.id).length,
      ),
    );
    if (values.json) {
      io.stdout.write(
        `${JSON.stringify(analyses.length === 1 && !values.all ? analyses[0] : analyses, null, 2)}\n`,
      );
    } else {
      const style = styleFor(io.stdout);
      io.stdout.write(
        analyses.map((a) => renderAnalysis(a, style)).join(`\n${style.dim('─'.repeat(60))}\n\n`),
      );
    }
    // Exit 1 when the black box found something worth a second look.
    const flagged = analyses.some(
      (a) =>
        a.verdicts.CONTRADICTED > 0 ||
        a.verdicts.STALE > 0 ||
        a.testwash.length > 0 ||
        a.nearMisses > 0,
    );
    return flagged ? ExitCode.failure : ExitCode.ok;
  } finally {
    store.close();
  }
}
