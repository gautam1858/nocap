import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzers/analyze.js';
import { codex } from '../../src/adapters/codex.js';
import { claudeCode } from '../../src/adapters/claude-code.js';
import { processFixture } from '../support/fixtures.js';
import type { SessionInfo } from '../../src/core/event.js';

function expectSession(): SessionInfo {
  throw new Error('fixture has no session');
}

// The basic Claude Code fixture is a scripted stale/narrowed story: the full
// suite fails, one file is re-run green, a test is written already skipped, then
// the agent declares the suite green.
describe('analyze on the Claude Code fixture', () => {
  const basic = processFixture(claudeCode, 'claude-code/2.1.316/basic.jsonl');
  const [session] = basic.result.sessions;
  const a = analyze(session ?? expectSession(), basic.result.events);

  it('audits the "all tests pass" claim as narrowed, not backed', () => {
    const testClaim = a.claims.find((c) => c.sentence.includes('All tests pass'));
    expect(testClaim?.verdict).toBe('NARROWED');
  });

  it('does not accuse without evidence', () => {
    expect(a.verdicts.CONTRADICTED).toBe(0);
  });

  it('notices the skipped test that was written', () => {
    expect(a.testwash.some((w) => w.kind === 'test-skipped')).toBe(true);
  });

  it('reports a probable cause', () => {
    expect(a.probableCause.length).toBeGreaterThan(0);
  });

  it('counts tools and files touched', () => {
    expect(a.stats.toolCalls).toBeGreaterThan(0);
    expect(a.stats.filesTouched).toContain('src/auth.ts');
  });
});

describe('analyze on the Codex fixture', () => {
  const legacy = processFixture(codex, 'codex/0.166.0/legacy.jsonl');
  const [session] = legacy.result.sessions;
  const a = analyze(session ?? expectSession(), legacy.result.events);

  it('backs the claim: the last run before it was a full go test that passed', () => {
    const claim = a.claims.find((c) => c.type === 'tests-pass');
    expect(claim?.verdict).toBe('BACKED');
  });

  it('relativises file paths to the session cwd', () => {
    expect(a.stats.filesTouched).toContain('src/cart.ts');
  });
});
