import { describe, expect, it } from 'vitest';
import { codex, parsePatch } from '../../src/adapters/codex.js';
import { eventsOf, fixturePath, processFixture, snapshotJson } from '../support/fixtures.js';

describe('codex adapter, 0.166.0 legacy rollouts', () => {
  const legacy = processFixture(codex, 'codex/0.166.0/legacy.jsonl');

  it('matches the golden events', async () => {
    await expect(snapshotJson(legacy.result)).toMatchFileSnapshot(
      fixturePath('codex/0.166.0/legacy.events.json'),
    );
  });

  it('recognises every record type in the fixture', () => {
    expect(legacy.result.unknown.size).toBe(0);
    expect(legacy.result.errors).toEqual([]);
  });

  it('describes the session from session_meta and turn_context', () => {
    expect(legacy.result.sessions).toEqual([
      {
        agent: 'codex',
        id: '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        cwd: '~/shop',
        cliVersion: '0.166.0',
        gitBranch: 'feat/cart',
        model: 'gpt-5.5-codex',
        startedAt: '2026-10-30T14:00:00.000Z',
        endedAt: '2026-10-30T14:00:25.000Z',
      },
    ]);
  });

  it('takes human prompts from user_message, not from injected context', () => {
    expect(eventsOf(legacy, 'prompt').map((e) => e.payload)).toEqual([
      { text: 'Add a discount code field to the cart and keep the tests green.', origin: 'human' },
    ]);
  });

  it('takes assistant prose once, from the response item', () => {
    expect(eventsOf(legacy, 'claim').map((e) => e.payload.text)).toEqual([
      'Added the discount field. All 18 tests pass.',
    ]);
  });

  it('reads exit codes from every shell output format', () => {
    expect(
      eventsOf(legacy, 'test_run').map((e) => [
        e.payload.runner,
        e.payload.status,
        e.payload.exitCode,
      ]),
    ).toEqual([
      ['npm', 'error', 1],
      ['jest', 'ok', 0],
      ['go', 'ok', 0],
      ['cargo', 'unknown', undefined],
    ]);
  });

  it('unwraps bash -lc so the command is what the agent actually ran', () => {
    const calls = eventsOf(legacy, 'tool_call').map((e) => e.payload.command);
    expect(calls).toContain('npx jest src/cart.test.ts');
    expect(calls).toContain('cargo test');
  });

  it('turns apply_patch into per-file changes, applied per patch_apply_end', () => {
    expect(eventsOf(legacy, 'edit').map((e) => e.payload)).toEqual([
      {
        callId: 'call_B',
        tool: 'apply_patch',
        status: 'applied',
        changes: [
          {
            path: 'src/cart.ts',
            op: 'update',
            patch: '@@\n-  return total;\n+  return applyDiscount(total, code);',
          },
          {
            path: 'src/discount.ts',
            op: 'create',
            patch: '+export const applyDiscount = (t: number, c: string) => t;',
          },
        ],
      },
    ]);
  });

  it('ignores repeated token counts and separates cached input', () => {
    const messages = eventsOf(legacy, 'cost').filter((e) => e.payload.scope === 'message');
    expect(messages.map((e) => e.payload.tokens)).toEqual([
      { input: 5000, output: 1500, cacheRead: 15000, cacheWrite: 0, reasoning: 600 },
      { input: 3000, output: 600, cacheRead: 7000, cacheWrite: 0, reasoning: 200 },
    ]);
    const totals = eventsOf(legacy, 'cost').filter((e) => e.payload.scope === 'session-total');
    expect(totals).toHaveLength(1);
    expect(totals[0]?.payload.tokens.output).toBe(2100);
    expect(totals[0]?.payload.usd).toBeUndefined();
  });
});

describe('codex adapter, 0.166.0 paginated rollouts', () => {
  const paginated = processFixture(codex, 'codex/0.166.0/paginated.jsonl');

  it('matches the golden events', async () => {
    await expect(snapshotJson(paginated.result)).toMatchFileSnapshot(
      fixturePath('codex/0.166.0/paginated.events.json'),
    );
  });

  it('recognises every record type in the fixture', () => {
    expect(paginated.result.unknown.size).toBe(0);
  });

  it('takes human prompts from item_completed UserMessage', () => {
    expect(eventsOf(paginated, 'prompt').map((e) => e.payload.text)).toEqual([
      'Run the integration tests and fix anything broken.',
    ]);
  });

  it('follows a long-running exec_command to the write_stdin that reports its exit code', () => {
    expect(
      eventsOf(paginated, 'test_run').map((e) => [
        e.payload.segment,
        e.payload.status,
        e.payload.exitCode,
      ]),
    ).toEqual([['pytest tests/integration -q', 'ok', 0]]);
  });

  it('records file deletions', () => {
    expect(eventsOf(paginated, 'edit').map((e) => [e.payload.status, e.payload.changes])).toEqual([
      ['applied', [{ path: 'tests/integration/test_flaky.py', op: 'delete', patch: '' }]],
    ]);
  });
});

describe('codex adapter, unrecognised input', () => {
  const unknown = processFixture(codex, 'codex/unknown-types.jsonl');

  it('reports unknown line, event and item types', () => {
    expect(Object.fromEntries(unknown.result.unknown)).toEqual({
      'event_msg:task_started': { count: 1, firstLine: 2 },
      'response_item:future_item': { count: 1, firstLine: 3 },
      'line:<no type>': { count: 1, firstLine: 4 },
    });
  });
});

describe('parsePatch', () => {
  it('handles moves', () => {
    expect(
      parsePatch(
        '*** Begin Patch\n*** Update File: a.ts\n*** Move to: b.ts\n@@\n-x\n+y\n*** End Patch',
      ),
    ).toEqual([{ path: 'a.ts', op: 'move', movedTo: 'b.ts', patch: '@@\n-x\n+y' }]);
  });
});
