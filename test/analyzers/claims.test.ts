import { describe, expect, it } from 'vitest';
import { extractClaims } from '../../src/analyzers/claims.js';

function types(text: string): string[] {
  return extractClaims({
    ts: '',
    agent: 'claude-code',
    sessionId: 's',
    kind: 'claim',
    line: 1,
    payload: { text },
  }).map((c) => c.type);
}
function first(text: string) {
  return extractClaims({
    ts: '',
    agent: 'claude-code',
    sessionId: 's',
    kind: 'claim',
    line: 1,
    payload: { text },
  })[0];
}

describe('claim extraction — test-pass', () => {
  it.each([
    'All tests pass.',
    'The tests are passing now.',
    'Tests pass.',
    'The suite is green.',
    'all 42 tests pass',
    'Everything passes.',
    'The test suite passes.',
    '42/42 passing',
    'All unit tests pass now.',
  ])('finds a claim in: %s', (text) => {
    expect(types(text)).toContain('tests-pass');
  });

  it.each([
    'Let me run the tests to see if they pass.',
    'The tests should pass once I fix this.',
    'This will make the tests pass.',
    '2 tests still fail.',
    'The tests are failing.',
    'Do the tests pass?',
    'I need to make sure the tests pass.',
    "If the tests pass, we're done.",
    'Show HN: nocap – I checked claims where "all tests pass" was a lie.',
  ])('does not fire on: %s', (text) => {
    expect(types(text)).not.toContain('tests-pass');
  });

  it('captures a stated count', () => {
    expect(first('All 17 tests pass.')?.count).toBe(17);
  });
});

describe('claim extraction — done/fixed', () => {
  it.each(['Done.', 'Fixed it.', 'All done.', 'That works now.', 'Good to go.'])(
    'finds: %s',
    (text) => {
      expect(types(text)).toContain('done');
    },
  );

  it.each([
    'Let me fix it.',
    'I need to fix the bug.',
    "I'm trying to fix this.",
    'Not done yet.',
    'Almost done.',
  ])('does not fire on: %s', (text) => {
    expect(types(text)).not.toContain('done');
  });

  it('does not double-count when the sentence is already a test-pass claim', () => {
    expect(types('Fixed, all tests pass.')).toEqual(['tests-pass']);
  });
});

describe('claim extraction — no-change', () => {
  it.each([
    ["I didn't touch the migrations folder.", 'migrations folder'],
    ['Without modifying the schema.', 'schema'],
    ['I left config.ts untouched.', 'config.ts'],
    ['No changes to the API layer.', 'API layer'],
  ])('finds %s with target %s', (text, target) => {
    const claim = first(text);
    expect(claim?.type).toBe('no-change');
    expect(claim?.target).toBe(target);
  });
});

describe('claim extraction — quoting and code', () => {
  it('ignores a claim phrase inside quotes', () => {
    expect(types('The card says "all tests pass" in the header.')).not.toContain('tests-pass');
  });

  it('ignores a claim phrase inside a code block', () => {
    expect(
      types('Here is the output:\n```\nAll tests pass\n```\nbut I have not run it.'),
    ).not.toContain('tests-pass');
  });

  it('still finds a real claim alongside a quoted one', () => {
    expect(types('Unlike the demo where it only "looks green", the tests pass here.')).toContain(
      'tests-pass',
    );
  });
});
