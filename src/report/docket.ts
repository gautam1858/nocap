import type { SessionAnalysis } from '../analyzers/analyze.js';
import type { Verdict } from '../analyzers/polygraph.js';

export interface DocketClaim {
  readonly time: string;
  readonly sentence: string;
  readonly verdict: Verdict;
  readonly verdictLabel: string;
  readonly evidence: readonly string[];
}

/** The display-ready content of a card, independent of HTML or SVG rendering. */
export interface Docket {
  readonly number: string;
  readonly agent: string;
  readonly subtitle: string;
  readonly rows: readonly { readonly key: string; readonly value: string; readonly note: string }[];
  readonly claimsLine: {
    readonly audited: number;
    readonly backed: number;
    readonly narrowed: number;
    readonly stale: number;
    readonly contradicted: number;
  };
  readonly claims: readonly DocketClaim[];
  readonly hiddenClaims: number;
  readonly integrity: SessionAnalysis['integrity'];
  readonly integrityNote: string;
  readonly nearMisses: number;
  readonly probableCause: string;
  readonly stamp: { readonly text: string; readonly tone: 'red' | 'amber' | 'green' | 'grey' };
  readonly footerLeft: string;
  readonly footerRight: string;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  BACKED: 'BACKED',
  STALE: 'STALE',
  NARROWED: 'NARROWED',
  NO_EVIDENCE: 'NO EVIDENCE',
  CONTRADICTED: 'CONTRADICTED',
};

function clock(ts: string | undefined): string {
  return ts ? ts.slice(11, 19) || ts : '—';
}

function duration(ms: number | undefined): string {
  if (ms === undefined) return 'unknown';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m)}m ${String(s % 60)}s`;
  return `${String(Math.floor(m / 60))}h ${String(m % 60)}m`;
}

function docketNumber(a: SessionAnalysis): string {
  const start = a.session.startedAt;
  const stamp = start
    ? `${start.slice(2, 4)}${start.slice(5, 7)}${start.slice(8, 10)}-${start.slice(11, 13)}${start.slice(14, 16)}`
    : '000000-0000';
  return `NC-${stamp}-${a.session.id.slice(0, 4).toUpperCase()}`;
}

function stampFor(a: SessionAnalysis): Docket['stamp'] {
  if (a.verdicts.CONTRADICTED > 0) return { text: 'CONTRADICTED', tone: 'red' };
  if (a.testwash.some((w) => w.afterFailingRun)) return { text: 'TESTWASH', tone: 'red' };
  if (a.verdicts.STALE > 0) return { text: 'STALE', tone: 'amber' };
  if (a.verdicts.NARROWED > 0) return { text: 'NARROWED', tone: 'amber' };
  if (a.verdicts.BACKED > 0) return { text: 'BACKED', tone: 'green' };
  return { text: 'NO FINDINGS', tone: 'grey' };
}

function plural(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}

function integrityNote(a: SessionAnalysis): string {
  const after = a.testwash.filter((w) => w.afterFailingRun);
  if (after.length > 0) return `${plural(after.length, 'test edit')} after a failing run`;
  if (a.testwash.length > 0) return `${plural(a.testwash.length, 'test edit')} noted`;
  return 'no test tampering detected';
}

export interface DocketOptions {
  /** A clearly-labelled reenactment of synthetic data (for the demo card). */
  readonly reenactment?: boolean;
  readonly maxClaims?: number;
}

export function toDocket(a: SessionAnalysis, options: DocketOptions = {}): Docket {
  const maxClaims = options.maxClaims ?? 5;
  const shown = a.claims.filter((c) => c.verdict !== 'NO_EVIDENCE');
  const cats = Object.entries(a.stats.byCategory).sort((x, y) => y[1] - x[1]);
  const files = a.stats.filesTouched;
  return {
    number: docketNumber(a),
    agent:
      `${a.session.agent}${a.session.cliVersion ? ` ${a.session.cliVersion}` : ''}`.toUpperCase(),
    subtitle: 'PROBABLE CAUSE REPORT',
    rows: [
      {
        key: 'FLIGHT',
        value: duration(a.stats.durationMs),
        note: `${clock(a.session.startedAt)} → ${clock(a.session.endedAt)}`,
      },
      {
        key: 'COST',
        value: a.stats.usd !== undefined ? `$${a.stats.usd.toFixed(2)}` : '—',
        note: a.stats.usd !== undefined ? 'as recorded by the agent' : 'not recorded by the agent',
      },
      {
        key: 'TOOLS FIRED',
        value: String(a.stats.toolCalls),
        note: cats.map(([c, n]) => `${c} ${String(n)}`).join(' · '),
      },
      {
        key: 'FILES TOUCHED',
        value: String(files.length),
        note: files.slice(0, 3).join(' · ') + (files.length > 3 ? ' …' : ''),
      },
    ],
    claimsLine: {
      audited: a.claims.length,
      backed: a.verdicts.BACKED,
      narrowed: a.verdicts.NARROWED,
      stale: a.verdicts.STALE,
      contradicted: a.verdicts.CONTRADICTED,
    },
    claims: shown.slice(0, maxClaims).map((c) => ({
      time: clock(c.ts),
      sentence: c.sentence.replace(/\s+/g, ' ').trim(),
      verdict: c.verdict,
      verdictLabel: VERDICT_LABEL[c.verdict],
      evidence: c.evidence.map((e) => e.text),
    })),
    hiddenClaims: Math.max(0, shown.length - maxClaims),
    integrity: a.integrity,
    integrityNote: integrityNote(a),
    nearMisses: a.nearMisses,
    probableCause: a.probableCause,
    stamp: stampFor(a),
    footerLeft: options.reenactment ? 'reenactment of synthetic data' : `docket ${docketNumber(a)}`,
    footerRight: 'nocap · 100% local',
  };
}
