import { describe, expect, it } from 'vitest';
import { analyze, type SessionAnalysis } from '../../src/analyzers/analyze.js';
import type { SessionInfo } from '../../src/core/event.js';
import { renderCardHtml, renderCardSvg } from '../../src/report/card.js';
import { toDocket } from '../../src/report/docket.js';
import { shareText } from '../../src/report/share.js';
import { Timeline } from '../analyzers/support.js';

const session: SessionInfo = {
  agent: 'claude-code',
  id: 'abcd1234-5678-4abc-8def-000000000000',
  cliVersion: '2.1.316',
  model: 'claude-opus-5-5',
  cwd: '/home/dev/secret-project',
  startedAt: '2026-10-30T09:00:00.000Z',
  endedAt: '2026-10-30T09:05:00.000Z',
};

function contradicted(): SessionAnalysis {
  const events = new Timeline()
    .prompt('fix the auth bug')
    .test('npm test', 1)
    .say('Done, all tests pass.')
    .done();
  return analyze(session, events);
}

describe('toDocket', () => {
  it('derives a docket number from the start time and session id', () => {
    expect(toDocket(contradicted()).number).toBe('NC-261030-0900-ABCD');
  });

  it('stamps CONTRADICTED when a claim is contradicted', () => {
    expect(toDocket(contradicted()).stamp).toEqual({ text: 'CONTRADICTED', tone: 'red' });
  });
});

describe('renderCardSvg', () => {
  const svg = renderCardSvg(contradicted(), { theme: 'dark' });

  it('is a self-contained SVG with no external references or scripts', () => {
    expect(svg).toMatch(/^<svg xmlns=/);
    // The only URL may be the SVG namespace; nothing is fetched.
    expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('href');
    expect(svg).not.toContain('url(http');
  });

  it('carries no absolute home path or the project directory name', () => {
    expect(svg).not.toContain('/home/dev');
    expect(svg).not.toContain('secret-project');
  });

  it('does not contain the human prompt', () => {
    expect(svg).not.toContain('fix the auth bug');
  });

  it('shows the verdict and the probable cause', () => {
    expect(svg).toContain('CONTRADICTED');
    expect(svg).toContain('PROBABLE CAUSE');
  });

  it('renders both themes', () => {
    expect(renderCardSvg(contradicted(), { theme: 'light' })).toMatch(/^<svg/);
  });

  it('escapes angle brackets from claim text', () => {
    const events = new Timeline()
      .prompt('x')
      .test('npm test', 0)
      .say('Tests pass for <Component/>.')
      .done();
    expect(renderCardSvg(analyze(session, events))).not.toContain('<Component/>');
  });
});

describe('renderCardHtml', () => {
  it('wraps the SVG in a standalone HTML document', () => {
    const html = renderCardHtml(contradicted());
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<svg');
    expect(html.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:\/\//);
  });
});

describe('shareText', () => {
  it('leads with the probable cause and no secrets or paths', () => {
    const text = shareText(contradicted());
    expect(text).toContain('PROBABLE CAUSE:');
    expect(text).toContain('#nocap');
    expect(text).not.toContain('/home/dev');
  });
});
