import type { EventOf, NocapEvent } from '../core/event.js';
import { extractClaims, type ClaimType } from './claims.js';
import { displayPath } from './paths.js';
import { testScope } from './scope.js';
import { isTestFile } from './testfiles.js';

export type Verdict = 'BACKED' | 'STALE' | 'NARROWED' | 'NO_EVIDENCE' | 'CONTRADICTED';

export const VERDICTS: readonly Verdict[] = [
  'BACKED',
  'STALE',
  'NARROWED',
  'NO_EVIDENCE',
  'CONTRADICTED',
];

export interface Evidence {
  readonly ts: string;
  readonly line: number;
  readonly text: string;
}

export interface AuditedClaim {
  readonly type: ClaimType;
  readonly sentence: string;
  readonly verdict: Verdict;
  readonly ts: string;
  readonly line: number;
  readonly sidechain: boolean;
  readonly evidence: readonly Evidence[];
}

// "done"/"fixed" is only auditable when it refers to something the logs show.
const DONE_TEST_CONTEXT =
  /\b(?:tests?|suite|spec|specs|build|ci|lint|typecheck|type-check|compil)/i;

function clock(ts: string): string {
  const t = ts.slice(11, 19);
  return t.length === 8 ? t : ts;
}

function statusWord(run: EventOf<'test_run'>['payload']): string {
  if (run.exitCode !== undefined) return `exit ${String(run.exitCode)}`;
  return run.status;
}

function runEvidence(run: EventOf<'test_run'>, label = 'test run'): Evidence {
  return {
    ts: run.ts,
    line: run.line,
    text: `${label}: ${run.payload.segment} → ${statusWord(run.payload)} at ${clock(run.ts)}`,
  };
}

interface Indexed {
  readonly i: number;
  readonly turn: number;
}

interface Edit extends Indexed {
  readonly ts: string;
  readonly line: number;
  readonly path: string;
  readonly isTest: boolean;
  readonly op: string;
  readonly sidechain: boolean;
}

interface Run extends Indexed {
  readonly event: EventOf<'test_run'>;
  readonly passed: boolean;
  readonly failed: boolean;
  readonly sidechain: boolean;
}

/** Tokens from a no-change target that are specific enough to match a file path. */
const GENERIC = new Set([
  'the',
  'a',
  'an',
  'any',
  'file',
  'files',
  'folder',
  'folders',
  'directory',
  'directories',
  'code',
  'logic',
  'test',
  'tests',
  'rest',
  'existing',
  'other',
  'others',
  'anything',
  'everything',
  'it',
  'that',
  'this',
  'your',
  'their',
  'our',
  'in',
  'of',
  'to',
  'else',
  'elsewhere',
  'more',
  'something',
  'nothing',
  'stuff',
  'things',
  'thing',
  'part',
  'parts',
]);

function targetTokens(target: string): string[] {
  return target
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .map((t) => t.replace(/^[./]+|[./]+$/g, ''))
    .filter((t) => t.length >= 3 && (!GENERIC.has(t) || t.includes('/') || t.includes('.')));
}

function pathMatchesTarget(path: string, tokens: readonly string[]): boolean {
  const lower = path.toLowerCase();
  const base = (lower.split('/').pop() ?? lower).replace(/\.[^.]+$/, '');
  return tokens.some((token) => {
    if (token.includes('/') || token.includes('.')) return lower.includes(token);
    // A bare word must match a whole path segment or the basename, not a substring.
    return base === token || lower.split(/[/._-]/).includes(token);
  });
}

export function polygraph(events: readonly NocapEvent[], cwd?: string): AuditedClaim[] {
  // Assign a turn number: it advances on each human prompt.
  const turns: number[] = [];
  let turn = 0;
  for (const event of events) {
    if (event.kind === 'prompt' && event.payload.origin === 'human') turn++;
    turns.push(turn);
  }

  const runs: Run[] = [];
  const edits: Edit[] = [];
  events.forEach((event, i) => {
    if (event.kind === 'test_run') {
      runs.push({
        i,
        turn: turns[i] ?? 0,
        event,
        passed: event.payload.status === 'ok',
        failed: event.payload.status === 'error',
        sidechain: event.sidechain === true,
      });
    } else if (event.kind === 'edit' && event.payload.status !== 'failed') {
      for (const change of event.payload.changes) {
        edits.push({
          i,
          turn: turns[i] ?? 0,
          ts: event.ts,
          line: event.line,
          path: displayPath(change.path, cwd),
          isTest: isTestFile(change.path),
          op: change.op,
          sidechain: event.sidechain === true,
        });
      }
    }
  });

  const auditTestClaim = (
    beforeIndex: number,
    turnFloor: number,
    sidechain: boolean,
  ): Pick<AuditedClaim, 'verdict' | 'evidence'> => {
    // Evidence comes from the same thread: a subagent's run neither backs nor
    // breaks a claim the main agent made, and vice versa.
    const prior = runs.filter(
      (r) => r.i < beforeIndex && r.turn >= turnFloor && r.sidechain === sidechain,
    );
    const recent = prior.at(-1);
    if (!recent) return { verdict: 'NO_EVIDENCE', evidence: [] };
    if (recent.failed)
      return { verdict: 'CONTRADICTED', evidence: [runEvidence(recent.event, 'last run failed')] };
    if (!recent.passed)
      return { verdict: 'NO_EVIDENCE', evidence: [runEvidence(recent.event, 'last run')] };

    const laterSourceEdits = edits.filter(
      (e) => e.i > recent.i && e.i < beforeIndex && !e.isTest && e.sidechain === sidechain,
    );
    if (laterSourceEdits.length > 0) {
      const edit = laterSourceEdits[0];
      return {
        verdict: 'STALE',
        evidence: [
          runEvidence(recent.event, 'passed'),
          ...(edit
            ? [
                {
                  ts: edit.ts,
                  line: edit.line,
                  text: `then ${edit.path} was edited at ${clock(edit.ts)}, with no re-run`,
                },
              ]
            : []),
        ],
      };
    }
    const scope = testScope(recent.event.payload);
    if (scope.narrowed) {
      return {
        verdict: 'NARROWED',
        evidence: [
          {
            ...runEvidence(recent.event, 'only run'),
            text: `${runEvidence(recent.event, 'only run').text} — ${scope.reason ?? 'partial run'}`,
          },
        ],
      };
    }
    return { verdict: 'BACKED', evidence: [runEvidence(recent.event, 'passed')] };
  };

  const audited: AuditedClaim[] = [];
  events.forEach((event, i) => {
    if (event.kind !== 'claim') return;
    const claimTurn = turns[i] ?? 0;
    const sidechain = event.sidechain === true;
    for (const claim of extractClaims(event)) {
      let result: Pick<AuditedClaim, 'verdict' | 'evidence'>;
      if (claim.type === 'tests-pass') {
        result = auditTestClaim(i, 0, sidechain);
      } else if (claim.type === 'done') {
        // A bare "done"/"fixed" is not mechanically checkable. Only verify it
        // when the sentence itself points at the thing we can see — tests or the
        // build — and only let it speak up when the evidence is against it.
        if (DONE_TEST_CONTEXT.test(claim.sentence)) {
          const r = auditTestClaim(i, claimTurn, sidechain);
          result = r.verdict === 'BACKED' ? { verdict: 'NO_EVIDENCE', evidence: [] } : r;
        } else {
          result = { verdict: 'NO_EVIDENCE', evidence: [] };
        }
      } else {
        result = auditNoChange(claim.target ?? '', i, claimTurn, sidechain, edits);
      }
      audited.push({
        type: claim.type,
        sentence: claim.sentence,
        verdict: result.verdict,
        evidence: result.evidence,
        ts: event.ts,
        line: event.line,
        sidechain: event.sidechain === true,
      });
    }
  });
  return audited;
}

function auditNoChange(
  target: string,
  beforeIndex: number,
  turnFloor: number,
  sidechain: boolean,
  edits: readonly Edit[],
): Pick<AuditedClaim, 'verdict' | 'evidence'> {
  const tokens = targetTokens(target);
  if (tokens.length === 0) return { verdict: 'NO_EVIDENCE', evidence: [] };
  const inScope = edits.filter(
    (e) => e.i < beforeIndex && e.turn >= turnFloor && e.sidechain === sidechain,
  );
  const hits = inScope.filter((e) => pathMatchesTarget(e.path, tokens));
  if (hits.length > 0) {
    const hit = hits[0];
    return {
      verdict: 'CONTRADICTED',
      evidence: hit
        ? [
            {
              ts: hit.ts,
              line: hit.line,
              text: `${hit.path} was ${hit.op === 'delete' ? 'deleted' : hit.op === 'create' ? 'created' : 'edited'} at ${clock(hit.ts)}`,
            },
          ]
        : [],
    };
  }
  // No matching edit. If the agent edited anything at all this turn, the claim of
  // not touching this specific thing is backed; if it edited nothing, there is
  // nothing to confirm against.
  return inScope.length > 0
    ? { verdict: 'BACKED', evidence: [] }
    : { verdict: 'NO_EVIDENCE', evidence: [] };
}
