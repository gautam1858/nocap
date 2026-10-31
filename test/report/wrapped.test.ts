import { describe, expect, it } from 'vitest';
import { analyze, type SessionAnalysis } from '../../src/analyzers/analyze.js';
import type { SessionInfo } from '../../src/core/event.js';
import { summarise } from '../../src/report/wrapped.js';
import { Timeline } from '../analyzers/support.js';

const NOW = Date.parse('2026-10-31T00:00:00.000Z');

function sessionAt(daysAgo: number, id: string): SessionInfo {
  const started = new Date(NOW - daysAgo * 86_400_000).toISOString();
  return { agent: 'claude-code', id, startedAt: started, endedAt: started };
}

function contradictedAt(daysAgo: number, id: string): SessionAnalysis {
  const events = new Timeline().prompt('fix').test('npm test', 1).say('All tests pass.').done();
  return analyze(sessionAt(daysAgo, id), events);
}

function cleanAt(daysAgo: number, id: string): SessionAnalysis {
  const events = new Timeline().prompt('fix').test('npm test', 0).say('All tests pass.').done();
  return analyze(sessionAt(daysAgo, id), events);
}

describe('summarise', () => {
  const analyses = [
    contradictedAt(1, 'a'),
    cleanAt(3, 'b'),
    contradictedAt(40, 'c'),
    cleanAt(400, 'd'),
  ];

  it('counts only sessions in the week', () => {
    const w = summarise(analyses, 'week', NOW);
    expect(w.sessions).toBe(2);
    expect(w.contradicted).toBe(1);
    expect(w.liesCaught).toBe(1);
  });

  it('counts the month', () => {
    expect(summarise(analyses, 'month', NOW).sessions).toBe(2);
  });

  it('counts the year', () => {
    expect(summarise(analyses, 'year', NOW).sessions).toBe(3);
  });

  it('counts everything with all', () => {
    const w = summarise(analyses, 'all', NOW);
    expect(w.sessions).toBe(4);
    expect(w.contradicted).toBe(2);
    expect(w.backed).toBe(2);
  });

  it('collects the worst probable causes', () => {
    const w = summarise(analyses, 'all', NOW);
    expect(w.worstCauses.length).toBeGreaterThan(0);
    expect(w.worstCauses[0]).toContain('failed');
  });

  it('handles an empty period', () => {
    expect(summarise([], 'week', NOW).sessions).toBe(0);
  });
});
