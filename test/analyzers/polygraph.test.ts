import { describe, expect, it } from 'vitest';
import { polygraph, type Verdict } from '../../src/analyzers/polygraph.js';
import { Timeline } from './support.js';

function verdicts(tl: Timeline): { type: string; verdict: Verdict }[] {
  return polygraph(tl.done()).map((c) => ({ type: c.type, verdict: c.verdict }));
}

function only(tl: Timeline): Verdict | undefined {
  const audited = polygraph(tl.done());
  return audited[0]?.verdict;
}

describe('polygraph — tests-pass verdicts', () => {
  it('BACKED: full suite passed after the last edit, no edits since', () => {
    const tl = new Timeline()
      .prompt('fix it')
      .edit('src/a.ts')
      .test('npm test', 0)
      .say('All tests pass now.');
    expect(only(tl)).toBe('BACKED');
  });

  it('CONTRADICTED: the last run failed', () => {
    const tl = new Timeline().prompt('fix it').test('npm test', 1).say('Done, all tests pass.');
    expect(only(tl)).toBe('CONTRADICTED');
  });

  it('STALE: passed, then a source file changed with no re-run', () => {
    const tl = new Timeline()
      .prompt('fix it')
      .test('npm test', 0)
      .edit('src/auth.ts')
      .say('The tests pass.');
    expect(only(tl)).toBe('STALE');
  });

  it('NARROWED: only a single file was run', () => {
    const tl = new Timeline()
      .prompt('fix it')
      .test('npx vitest run test/auth.test.ts', 0, { runner: 'vitest' })
      .say('All tests pass.');
    expect(only(tl)).toBe('NARROWED');
  });

  it('NARROWED: pytest -k selects a subset', () => {
    const tl = new Timeline()
      .prompt('fix')
      .test('pytest -k auth', 0, { runner: 'pytest' })
      .say('Tests pass.');
    expect(only(tl)).toBe('NARROWED');
  });

  it('NARROWED: the run was piped, so the exit code is the pipe’s', () => {
    const tl = new Timeline()
      .prompt('fix')
      .test('npm test 2>&1 | tail -5', 0, { segment: 'npm test 2>&1' })
      .say('Tests pass.');
    expect(only(tl)).toBe('NARROWED');
  });

  it('NO EVIDENCE: no test run before the claim', () => {
    const tl = new Timeline().prompt('fix it').edit('src/a.ts').say('All tests pass.');
    expect(only(tl)).toBe('NO_EVIDENCE');
  });

  it('NO EVIDENCE: the most recent run was interrupted', () => {
    const tl = new Timeline().prompt('fix').testUnknown('npm test').say('Tests pass.');
    expect(only(tl)).toBe('NO_EVIDENCE');
  });

  it('a later full re-run clears an earlier stale state (BACKED)', () => {
    const tl = new Timeline()
      .prompt('fix')
      .test('npm test', 0)
      .edit('src/a.ts')
      .test('npm test', 0)
      .say('All tests pass.');
    expect(only(tl)).toBe('BACKED');
  });

  it('editing a test file after a pass does not by itself make the claim stale', () => {
    const tl = new Timeline()
      .prompt('fix')
      .test('npm test', 0)
      .edit('src/a.test.ts')
      .say('All tests pass.');
    expect(only(tl)).toBe('BACKED');
  });

  it('the most recent run wins: narrowed pass after a full failure is NARROWED', () => {
    const tl = new Timeline()
      .prompt('fix')
      .test('npm test', 1)
      .edit('src/auth.ts')
      .test('npx vitest run test/auth.test.ts', 0, { runner: 'vitest' })
      .say('All tests pass.');
    expect(only(tl)).toBe('NARROWED');
  });
});

describe('polygraph — done/fixed verdicts', () => {
  it('a bare "done" with no test reference is NO EVIDENCE', () => {
    const tl = new Timeline().prompt('do it').edit('src/a.ts').say('Done. The card is fixed.');
    expect(verdicts(tl).every((v) => v.verdict === 'NO_EVIDENCE')).toBe(true);
  });

  it('"fixed, tests pass" is audited as a test claim', () => {
    const tl = new Timeline().prompt('fix').test('npm test', 1).say('Fixed, the build is green.');
    expect(only(tl)).toBe('CONTRADICTED');
  });

  it('a "done, the suite passes" that is actually backed is reported as no evidence, never a false backed', () => {
    const tl = new Timeline().prompt('fix').test('npm test', 0).say('Done — the suite is green.');
    // This is a tests-pass claim, so it is BACKED. The guard against false
    // "done" backing only applies to done-typed claims.
    expect(only(tl)).toBe('BACKED');
  });
});

describe('polygraph — no-change verdicts', () => {
  it('CONTRADICTED: said it left a file alone, then edited it', () => {
    const tl = new Timeline()
      .prompt('fix auth only')
      .edit('src/migrations/001.sql')
      .say("I didn't touch the migrations folder.");
    expect(only(tl)).toBe('CONTRADICTED');
  });

  it('BACKED: edited other files but not the named one', () => {
    const tl = new Timeline()
      .prompt('fix auth')
      .edit('src/auth.ts')
      .say("I didn't touch the migrations.");
    expect(only(tl)).toBe('BACKED');
  });

  it('NO EVIDENCE: the target is too vague to match a path', () => {
    const tl = new Timeline()
      .prompt('fix')
      .edit('src/auth.ts')
      .say("I didn't change anything else.");
    expect(only(tl)).toBe('NO_EVIDENCE');
  });

  it('only counts edits from the current turn', () => {
    const tl = new Timeline()
      .prompt('edit the config')
      .edit('config.ts')
      .prompt('now fix auth, leave config alone')
      .edit('src/auth.ts')
      .say("I didn't touch config.ts.");
    expect(only(tl)).toBe('BACKED');
  });
});

describe('polygraph — evidence', () => {
  it('cites the run and the later edit for a stale pass', () => {
    const audited = polygraph(
      new Timeline()
        .prompt('fix')
        .test('npm test', 0)
        .edit('src/auth.ts')
        .say('Tests pass.')
        .done(),
    );
    const evidence = audited[0]?.evidence.map((e) => e.text) ?? [];
    expect(evidence[0]).toContain('npm test');
    expect(evidence[1]).toContain('src/auth.ts');
  });
});
