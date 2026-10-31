import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyze } from '../../src/analyzers/analyze.js';
import type { SessionInfo } from '../../src/core/event.js';
import { renderCardSvg } from '../../src/report/card.js';
import { svgToPng } from '../../src/report/render-png.js';
import { takeAttempts } from '../support/network-tripwire.mjs';
import { Timeline } from '../analyzers/support.js';

const session: SessionInfo = {
  agent: 'claude-code',
  id: 'pngtest0',
  startedAt: '2026-10-30T09:00:00.000Z',
};
const svg = renderCardSvg(
  analyze(session, new Timeline().prompt('x').test('npm test', 1).say('All tests pass.').done()),
);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nocap-png-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// The bundled wasm renderer must produce a PNG with no network access. The
// global tripwire would already fail the suite on any connection; this asserts
// the happy path explicitly and checks the bytes are a real PNG.
describe('PNG rendering is offline and real', () => {
  it('renders the card to a PNG with the bundled wasm renderer', async () => {
    const out = join(dir, 'card.png');
    const result = await svgToPng(svg, out);
    expect(result).toEqual({ ok: true, renderer: 'resvg-wasm' });
    expect(takeAttempts()).toEqual([]);
    const bytes = readFileSync(out);
    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
