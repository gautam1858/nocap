import type { SessionAnalysis } from '../analyzers/analyze.js';

/** A ready-to-post one-liner. No paths, no secrets — just the verdict and the numbers. */
export function shareText(a: SessionAnalysis): string {
  const caught =
    a.verdicts.CONTRADICTED + a.verdicts.STALE + a.testwash.filter((w) => w.afterFailingRun).length;
  const headline =
    caught > 0
      ? `nocap caught ${String(caught)} thing(s) my agent glossed over.`
      : a.verdicts.NARROWED > 0
        ? 'nocap found a partial test run reported as a pass.'
        : 'nocap audited my agent and it checked out.';
  const stats = [
    `${String(a.claims.length)} claims audited`,
    `${String(a.verdicts.BACKED)} backed`,
    `${String(a.verdicts.CONTRADICTED)} contradicted`,
    `integrity ${a.integrity}`,
  ].join(' · ');
  return `🪪 ${headline}\n\nPROBABLE CAUSE: ${a.probableCause}\n\n${stats}\n100% local. #nocap`;
}
