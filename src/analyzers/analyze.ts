import type { NocapEvent, SessionInfo, ToolCategory, TokenUsage } from '../core/event.js';
import { displayPath } from './paths.js';
import { polygraph, VERDICTS, type AuditedClaim, type Verdict } from './polygraph.js';
import { testwash, type TestwashFinding } from './testwash.js';

export type IntegrityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SessionStats {
  readonly durationMs?: number;
  readonly toolCalls: number;
  readonly byCategory: Partial<Record<ToolCategory, number>>;
  readonly filesTouched: readonly string[];
  readonly testRuns: number;
  readonly tokens: TokenUsage;
  readonly usd?: number;
}

export interface SessionAnalysis {
  readonly session: SessionInfo;
  readonly stats: SessionStats;
  readonly claims: readonly AuditedClaim[];
  readonly verdicts: Record<Verdict, number>;
  readonly testwash: readonly TestwashFinding[];
  readonly integrity: IntegrityGrade;
  readonly nearMisses: number;
  readonly probableCause: string;
}

const EMPTY_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function computeStats(events: readonly NocapEvent[], cwd: string | undefined): SessionStats {
  const byCategory: Partial<Record<ToolCategory, number>> = {};
  const files = new Set<string>();
  let toolCalls = 0;
  let testRuns = 0;
  let first: string | undefined;
  let last: string | undefined;
  let sessionTotal: TokenUsage | undefined;
  const summed: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
  } = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  };
  let usd: number | undefined;
  let sawMessageCost = false;

  for (const event of events) {
    if (event.ts) {
      first ??= event.ts;
      if (!last || event.ts > last) last = event.ts;
    }
    switch (event.kind) {
      case 'tool_call':
        toolCalls++;
        byCategory[event.payload.category] = (byCategory[event.payload.category] ?? 0) + 1;
        break;
      case 'test_run':
        testRuns++;
        break;
      case 'edit':
        if (event.payload.status !== 'failed')
          for (const c of event.payload.changes) files.add(displayPath(c.path, cwd));
        break;
      case 'cost':
        if (event.payload.scope === 'session-total') {
          sessionTotal = event.payload.tokens;
          if (event.payload.usd !== undefined) usd = event.payload.usd;
        } else {
          sawMessageCost = true;
          summed.input += event.payload.tokens.input;
          summed.output += event.payload.tokens.output;
          summed.cacheRead += event.payload.tokens.cacheRead;
          summed.cacheWrite += event.payload.tokens.cacheWrite;
          summed.reasoning += event.payload.tokens.reasoning ?? 0;
        }
        break;
      default:
        break;
    }
  }

  const tokens: TokenUsage = sessionTotal ?? (sawMessageCost ? summed : EMPTY_TOKENS);
  const durationMs = first && last ? Math.max(0, Date.parse(last) - Date.parse(first)) : undefined;
  return {
    ...(durationMs !== undefined && !Number.isNaN(durationMs) ? { durationMs } : {}),
    toolCalls,
    byCategory,
    filesTouched: [...files].sort(),
    testRuns,
    tokens,
    ...(usd !== undefined ? { usd } : {}),
  };
}

function gradeFor(
  claims: readonly AuditedClaim[],
  washes: readonly TestwashFinding[],
): IntegrityGrade {
  let score = 100;
  for (const w of washes) {
    // Expected-value changes and assertion edits are routine during development;
    // they only look like tampering when they follow a failing run. Skips and
    // deletions are suspicious either way. Nothing drives the grade down on an
    // edit that was not preceded by a failure.
    if (!w.afterFailingRun) {
      score -= w.kind === 'test-file-deleted' ? 20 : w.kind === 'test-skipped' ? 4 : 0;
      continue;
    }
    score -=
      w.kind === 'test-file-deleted'
        ? 45
        : w.kind === 'assertions-removed'
          ? 25
          : w.kind === 'test-skipped'
            ? 20
            : 12;
  }
  // Claim accuracy nudges the grade; it is reported in full separately. The
  // soft verdicts are capped so a long session full of partial runs during
  // normal development lands at C, not F.
  score -= 30 * claims.filter((c) => c.verdict === 'CONTRADICTED').length;
  score -= Math.min(30, 10 * claims.filter((c) => c.verdict === 'STALE').length);
  score -= Math.min(24, 3 * claims.filter((c) => c.verdict === 'NARROWED').length);
  // A test weakened after a failing run, or a contradicted test claim, is a real
  // integrity problem: the grade cannot be better than C, to match the card's stamp.
  const serious =
    washes.some((w) => w.afterFailingRun) || claims.some((c) => c.verdict === 'CONTRADICTED');
  const cap = serious ? 70 : 100;
  score = Math.min(score, cap);
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 55) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

function probableCause(
  claims: readonly AuditedClaim[],
  washes: readonly TestwashFinding[],
): string {
  const testClaims = claims.filter((c) => c.type === 'tests-pass' || c.type === 'done');
  const has = (v: Verdict): boolean => testClaims.some((c) => c.verdict === v);
  // Only let testwash drive the headline when it followed a failing run; a bare
  // edit to a test during development is not an accusation.
  const deleted = washes.find((w) => w.kind === 'test-file-deleted' && w.afterFailingRun);
  const weakened = washes.find(
    (w) =>
      w.afterFailingRun &&
      (w.kind === 'assertions-removed' ||
        w.kind === 'expected-changed' ||
        w.kind === 'test-skipped'),
  );

  if (has('CONTRADICTED')) {
    return 'Agent reported passing tests after a run that failed and was not repeated. The black box disagrees.';
  }
  if (deleted && weakened) {
    return 'A test file was deleted and assertions were weakened after a failing run; a green result here proves nothing.';
  }
  if (deleted) {
    return 'A test file was deleted after a run failed. Fewer tests is not the same as passing tests.';
  }
  if (weakened) {
    return `Tests were ${weakened.kind === 'test-skipped' ? 'skipped' : 'weakened'} after a failing run; the suite was made easier to pass.`;
  }
  if (has('STALE')) {
    return 'Agent reported a stale test pass: the code changed after the last green run, which was never repeated.';
  }
  if (has('NARROWED')) {
    return 'Agent reported the suite green on the strength of a partial run. The whole suite was not verified.';
  }
  const contradictedChange = claims.find(
    (c) => c.type === 'no-change' && c.verdict === 'CONTRADICTED',
  );
  if (contradictedChange) {
    return 'Agent said it left a file alone, then edited it. The claim and the diff disagree.';
  }
  const auditable = claims.filter((c) => c.verdict !== 'NO_EVIDENCE');
  if (auditable.length > 0 && auditable.every((c) => c.verdict === 'BACKED')) {
    return 'Claims checked out against the evidence. No discrepancies found.';
  }
  if (claims.length === 0) return 'No auditable claims in this session. Nothing to contradict.';
  return 'Claims were made that the session logs cannot confirm either way.';
}

export function analyze(
  session: SessionInfo,
  events: readonly NocapEvent[],
  nearMisses = 0,
): SessionAnalysis {
  const claims = polygraph(events, session.cwd);
  const washes = testwash(events, session.cwd);
  const verdicts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
  for (const c of claims) verdicts[c.verdict]++;
  return {
    session,
    stats: computeStats(events, session.cwd),
    claims,
    verdicts,
    testwash: washes,
    integrity: gradeFor(claims, washes),
    nearMisses,
    probableCause: probableCause(claims, washes),
  };
}
