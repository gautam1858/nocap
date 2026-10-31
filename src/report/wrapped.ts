import type { SessionAnalysis } from '../analyzers/analyze.js';

export type Period = 'week' | 'month' | 'year' | 'all';

export const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export interface Wrapped {
  readonly period: Period;
  readonly since?: string;
  readonly sessions: number;
  readonly durationMs: number;
  readonly usd: number;
  readonly usdKnown: boolean;
  readonly toolCalls: number;
  readonly filesTouched: number;
  readonly claimsAudited: number;
  readonly backed: number;
  readonly narrowed: number;
  readonly stale: number;
  readonly contradicted: number;
  readonly liesCaught: number;
  readonly nearMisses: number;
  readonly testwash: number;
  readonly worstCauses: readonly string[];
  readonly busiestDay?: { date: string; sessions: number };
}

function sinceIso(period: Period, now: number): string | undefined {
  if (period === 'all') return undefined;
  return new Date(now - PERIOD_DAYS[period] * 86_400_000).toISOString();
}

export function summarise(
  analyses: readonly SessionAnalysis[],
  period: Period,
  now = Date.now(),
): Wrapped {
  const since = sinceIso(period, now);
  const inPeriod = analyses.filter(
    (a) => since === undefined || (a.session.startedAt ?? '') >= since,
  );

  let durationMs = 0;
  let usd = 0;
  let usdKnown = false;
  let toolCalls = 0;
  let filesTouched = 0;
  let backed = 0;
  let narrowed = 0;
  let stale = 0;
  let contradicted = 0;
  let claimsAudited = 0;
  let nearMisses = 0;
  let testwash = 0;
  let liesCaught = 0;
  const causes: { cause: string; weight: number }[] = [];
  const byDay = new Map<string, number>();

  for (const a of inPeriod) {
    durationMs += a.stats.durationMs ?? 0;
    if (a.stats.usd !== undefined) {
      usd += a.stats.usd;
      usdKnown = true;
    }
    toolCalls += a.stats.toolCalls;
    filesTouched += a.stats.filesTouched.length;
    claimsAudited += a.claims.length;
    backed += a.verdicts.BACKED;
    narrowed += a.verdicts.NARROWED;
    stale += a.verdicts.STALE;
    contradicted += a.verdicts.CONTRADICTED;
    nearMisses += a.nearMisses;
    const washAfterFail = a.testwash.filter((w) => w.afterFailingRun).length;
    testwash += washAfterFail;
    const caught = a.verdicts.CONTRADICTED + a.verdicts.STALE + washAfterFail;
    liesCaught += caught;
    if (caught > 0)
      causes.push({
        cause: a.probableCause,
        weight: a.verdicts.CONTRADICTED * 3 + a.verdicts.STALE * 2 + washAfterFail * 2,
      });
    const day = a.session.startedAt?.slice(0, 10);
    if (day) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    period,
    ...(since !== undefined ? { since } : {}),
    sessions: inPeriod.length,
    durationMs,
    usd,
    usdKnown,
    toolCalls,
    filesTouched,
    claimsAudited,
    backed,
    narrowed,
    stale,
    contradicted,
    liesCaught,
    nearMisses,
    testwash,
    worstCauses: causes
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3)
      .map((c) => c.cause),
    ...(busiest ? { busiestDay: { date: busiest[0], sessions: busiest[1] } } : {}),
  };
}
