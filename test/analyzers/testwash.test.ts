import { describe, expect, it } from 'vitest';
import { testwash } from '../../src/analyzers/testwash.js';
import type { FileChange, NocapEvent } from '../../src/core/event.js';

let seq = 0;
function editEvent(
  path: string,
  change: Partial<FileChange>,
  ts = '2026-10-30T09:00:00.000Z',
): NocapEvent {
  seq += 1;
  return {
    ts,
    line: seq,
    agent: 'claude-code',
    sessionId: 's',
    kind: 'edit',
    payload: {
      callId: `e${String(seq)}`,
      tool: 'Edit',
      status: 'applied',
      changes: [{ path, op: 'update', ...change }],
    },
  };
}
function failingRun(): NocapEvent {
  seq += 1;
  return {
    ts: '2026-10-30T08:59:00.000Z',
    line: seq,
    agent: 'claude-code',
    sessionId: 's',
    kind: 'test_run',
    payload: {
      callId: 'r',
      command: 'npm test',
      segment: 'npm test',
      runner: 'npm',
      status: 'error',
      exitCode: 1,
      startedAt: '2026-10-30T08:59:00.000Z',
    },
  };
}

const kinds = (events: NocapEvent[]) => testwash(events).map((f) => f.kind);

describe('testwash', () => {
  it('flags a skip marker added to a test file', () => {
    const e = editEvent('a.test.ts', {
      before: 'it("works", () => expect(x).toBe(1));',
      after: 'it.skip("works", () => expect(x).toBe(1));',
    });
    expect(kinds([e])).toContain('test-skipped');
  });

  it('flags pytest skip', () => {
    const e = editEvent('test_a.py', {
      before: 'def test_x():\n    assert f() == 1',
      after: '@pytest.mark.skip\ndef test_x():\n    assert f() == 1',
    });
    expect(kinds([e])).toContain('test-skipped');
  });

  it('flags a deleted test file', () => {
    const e = editEvent('a.test.ts', { op: 'delete', before: 'it("works", () => {})' });
    expect(kinds([e])).toContain('test-file-deleted');
  });

  it('flags removed assertions', () => {
    const e = editEvent('a.test.ts', {
      before: 'expect(a).toBe(1);\nexpect(b).toBe(2);\nexpect(c).toBe(3);',
      after: 'expect(a).toBe(1);',
    });
    expect(kinds([e])).toContain('assertions-removed');
  });

  it('flags a changed expected value', () => {
    const e = editEvent('a.test.ts', {
      before: 'expect(total).toBe(100);',
      after: 'expect(total).toBe(142);',
    });
    expect(kinds([e])).toContain('expected-changed');
  });

  it('does not flag edits to non-test files', () => {
    const e = editEvent('src/app.ts', { before: 'const x = 1;', after: 'const x = 2;' });
    expect(kinds([e])).toEqual([]);
  });

  it('does not flag adding a new assertion', () => {
    const e = editEvent('a.test.ts', {
      before: 'expect(a).toBe(1);',
      after: 'expect(a).toBe(1);\nexpect(b).toBe(2);',
    });
    expect(kinds([e])).toEqual([]);
  });

  it('marks whether the edit followed a failing run', () => {
    const before = testwash([editEvent('a.test.ts', { before: 'x', after: 'it.skip("x")' })]);
    expect(before[0]?.afterFailingRun).toBe(false);
    const after = testwash([
      failingRun(),
      editEvent('a.test.ts', { before: 'x', after: 'it.skip("x")' }),
    ]);
    expect(after[0]?.afterFailingRun).toBe(true);
  });

  it('handles Codex patch bodies', () => {
    const e = editEvent('cart_test.go', {
      patch: '@@\n-\tif got != 5 { t.Error("bad") }\n+\t// if got != 5 { t.Error("bad") }',
    });
    expect(kinds([e])).toContain('assertions-removed');
  });
});
