import type { EventOf, NocapEvent } from '../core/event.js';
import { changeLines } from './diff.js';
import { displayPath } from './paths.js';
import { isTestFile } from './testfiles.js';

export type TestwashKind =
  'test-skipped' | 'assertions-removed' | 'expected-changed' | 'test-file-deleted';

export interface TestwashFinding {
  readonly kind: TestwashKind;
  readonly path: string;
  readonly ts: string;
  readonly line: number;
  readonly detail: string;
  /** True when a test run failed earlier in the session, before this edit. */
  readonly afterFailingRun: boolean;
  readonly sidechain: boolean;
}

// Markers that disable a test, by language.
const SKIP_MARKERS: readonly RegExp[] = [
  /\b(?:x(?:it|describe|test)|f(?:it|describe))\s*\(/, // xit( fdescribe(
  /\b(?:it|describe|test|context|suite|bench)\s*\.\s*(?:skip|todo|only)\b/,
  /\.(?:skip|only)\s*\(/,
  /@(?:pytest\.mark\.)?skip(?:if)?\b/,
  /@(?:unittest\.)?skip(?:If|Unless)?\b/,
  /\bpytest\.skip\s*\(/,
  /\bself\.skipTest\s*\(/,
  /\bt\.Skip(?:Now)?\s*\(/,
  /\b(?:skip|pending|xit|xspecify)\b\s*(?:['"]|$)/,
  /#\[ignore\]/, // Rust
];

// Lines that assert something.
const ASSERT =
  /\b(?:assert\w*|expect|should|t\.(?:Error|Fatal|Fail|Errorf|Fatalf)|require\.\w|XCTAssert\w*|EXPECT_\w+|ASSERT_\w+|chai|\.to\.(?:equal|be|deep)|\.toBe|\.toEqual|\.toMatch|\.toThrow|\.toHaveBeen)\b/;

// The expected literal in common assertion shapes.
const EXPECTED_LITERAL =
  /(?:toBe|toEqual|toStrictEqual|toMatch|assertEqual|assertEquals|assert_equal|\.equal|\.eql|==|===)\s*\(?\s*(['"`]?[\w.-]+['"`]?)/;

function isSkip(line: string): boolean {
  return SKIP_MARKERS.some((p) => p.test(line));
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? `${flat.slice(0, 69)}…` : flat;
}

// A commented-out assertion is a removed assertion, not a live one.
const COMMENT = /^\s*(?:\/\/|#|\/\*|\*|--|;)/;

function countAsserts(lines: readonly string[]): number {
  return lines.filter((l) => ASSERT.test(l) && !COMMENT.test(l)).length;
}

/** Pairs a removed and an added assertion that differ only in the expected value. */
function changedExpectations(added: readonly string[], removed: readonly string[]): string[] {
  const changes: string[] = [];
  const addedByShape = new Map<string, string[]>();
  for (const line of added) {
    const shape = line.replace(
      EXPECTED_LITERAL,
      (m, lit: string) => m.slice(0, m.length - lit.length) + '§',
    );
    if (shape !== line)
      addedByShape.set(shape.trim(), [...(addedByShape.get(shape.trim()) ?? []), line.trim()]);
  }
  for (const line of removed) {
    const removedLit = EXPECTED_LITERAL.exec(line);
    if (!removedLit) continue;
    const shape = line
      .replace(EXPECTED_LITERAL, (m, lit: string) => m.slice(0, m.length - lit.length) + '§')
      .trim();
    const matches = addedByShape.get(shape);
    if (!matches) continue;
    const addedLit = matches
      .map((a) => EXPECTED_LITERAL.exec(a)?.[1])
      .find((v) => v !== undefined && v !== removedLit[1]);
    if (addedLit !== undefined) changes.push(`${removedLit[1] ?? '?'} → ${addedLit}`);
  }
  return changes;
}

export interface RawFinding {
  readonly kind: TestwashKind;
  readonly detail: string;
}

/**
 * The language-level checks for one change to a test file, shared by the
 * session analyzer and the PR-diff reviewer. `path` must already be a test file.
 */
export function inspectTestChange(
  path: string,
  op: 'delete' | 'other',
  added: readonly string[],
  removed: readonly string[],
): RawFinding[] {
  if (op === 'delete') return [{ kind: 'test-file-deleted', detail: `test file ${path} deleted` }];
  const findings: RawFinding[] = [];

  const addedSkips = added.filter(isSkip);
  const removedSkips = removed.filter(isSkip);
  if (addedSkips.length > removedSkips.length) {
    findings.push({
      kind: 'test-skipped',
      detail: `skip marker added: ${oneLine(addedSkips[0] ?? '')}`,
    });
  }

  const expectationChanges = changedExpectations(added, removed);
  if (expectationChanges.length > 0) {
    findings.push({
      kind: 'expected-changed',
      detail: `expected value changed: ${expectationChanges.join(', ').slice(0, 120)}`,
    });
  }

  // Only flag a net loss of assertions beyond what an expected-value change explains.
  const netRemoved = countAsserts(removed) - countAsserts(added) - expectationChanges.length;
  if (netRemoved > 0) {
    findings.push({
      kind: 'assertions-removed',
      detail: `${String(netRemoved)} assertion(s) removed`,
    });
  }
  return findings;
}

export function testwash(events: readonly NocapEvent[], cwd?: string): TestwashFinding[] {
  const findings: TestwashFinding[] = [];
  let failedEarlier = false;

  for (const event of events) {
    if (event.kind === 'test_run' && event.payload.status === 'error') {
      failedEarlier = true;
      continue;
    }
    if (event.kind !== 'edit' || event.payload.status === 'failed') continue;
    const edit: EventOf<'edit'> = event;

    for (const change of edit.payload.changes) {
      if (!isTestFile(change.path)) continue;
      const path = displayPath(change.path, cwd);
      const { added, removed } = changeLines(change);
      for (const raw of inspectTestChange(
        path,
        change.op === 'delete' ? 'delete' : 'other',
        added,
        removed,
      )) {
        findings.push({
          ...raw,
          path,
          ts: edit.ts,
          line: edit.line,
          afterFailingRun: failedEarlier,
          sidechain: edit.sidechain === true,
        });
      }
    }
  }
  return findings;
}
