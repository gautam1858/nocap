import { describe, expect, it } from 'vitest';
import { claudeCode } from '../../src/adapters/claude-code.js';
import { eventsOf, fixturePath, processFixture, snapshotJson } from '../support/fixtures.js';

const basic = processFixture(claudeCode, 'claude-code/2.1.316/basic.jsonl');

describe('claude-code adapter, 2.1.316 transcripts', () => {
  it('matches the golden events', async () => {
    await expect(snapshotJson(basic.result)).toMatchFileSnapshot(
      fixturePath('claude-code/2.1.316/basic.events.json'),
    );
  });

  it('recognises every record type in the fixture', () => {
    expect(basic.result.unknown.size).toBe(0);
    expect(basic.result.errors).toEqual([]);
  });

  it('describes the session', () => {
    expect(basic.result.sessions).toEqual([
      {
        agent: 'claude-code',
        id: '11111111-2222-4333-8444-555555555555',
        cwd: '~/acme',
        cliVersion: '2.1.316',
        model: 'claude-opus-5-5',
        gitBranch: 'main',
        startedAt: '2026-10-30T09:00:00.000Z',
        endedAt: '2026-10-30T09:01:30.000Z',
      },
    ]);
  });

  it('separates human prompts from harness notifications, including mid-turn messages', () => {
    expect(
      eventsOf(basic, 'prompt').map((e) => [e.payload.origin, e.payload.text.slice(0, 30)]),
    ).toEqual([
      ['human', 'Fix the failing auth test and '],
      ['human', "also don't touch the migration"],
      ['system', '<task-notification>\n<task-id>b'],
    ]);
  });

  it('reads exit codes and statuses for test runs', () => {
    expect(
      eventsOf(basic, 'test_run').map((e) => ({
        segment: e.payload.segment,
        runner: e.payload.runner,
        status: e.payload.status,
        exitCode: e.payload.exitCode,
      })),
    ).toEqual([
      { segment: 'npm test 2>&1', runner: 'npm', status: 'error', exitCode: 1 },
      { segment: 'npx vitest run test/auth.test.ts', runner: 'vitest', status: 'ok', exitCode: 0 },
      { segment: 'pytest -k auth', runner: 'pytest', status: 'interrupted', exitCode: undefined },
      { segment: 'npm test', runner: 'npm', status: 'unknown', exitCode: undefined },
    ]);
  });

  it('records the time a test run finished and the time it started', () => {
    const [first] = eventsOf(basic, 'test_run');
    expect(first?.payload.startedAt).toBe('2026-10-30T09:00:02.500Z');
    expect(first?.ts).toBe('2026-10-30T09:00:09.000Z');
  });

  it('marks background commands as such rather than guessing an exit code', () => {
    const background = eventsOf(basic, 'tool_result').find((e) => e.payload.callId === 'toolu_05');
    expect(background?.payload).toMatchObject({ status: 'background' });
    expect(background?.payload.exitCode).toBeUndefined();
  });

  it('turns Edit and Write calls into file changes with home paths rewritten', () => {
    expect(eventsOf(basic, 'edit').map((e) => e.payload)).toEqual([
      {
        callId: 'toolu_02',
        tool: 'Edit',
        status: 'applied',
        changes: [
          {
            path: '~/acme/src/auth.ts',
            op: 'update',
            before: 'if (now - exp > skew)',
            after: 'if (now - exp < skew)',
          },
        ],
      },
      {
        callId: 'toolu_04',
        tool: 'Write',
        status: 'applied',
        changes: [
          {
            path: '~/acme/test/clock.test.ts',
            op: 'create',
            after: "import { it } from 'vitest';\nit.skip('handles leap seconds', () => {});\n",
          },
        ],
      },
    ]);
  });

  it('counts each model response once, at its final usage', () => {
    const messages = eventsOf(basic, 'cost').filter((e) => e.payload.scope === 'message');
    expect(messages).toHaveLength(8);
    expect(messages[0]?.payload.tokens).toEqual({
      input: 1200,
      output: 85,
      cacheRead: 5000,
      cacheWrite: 300,
    });
  });

  it("keeps the agent's own dollar total", () => {
    const totals = eventsOf(basic, 'cost').filter((e) => e.payload.scope === 'session-total');
    expect(totals.map((e) => e.payload.usd)).toEqual([0.4213]);
  });

  it('flags subagent activity', () => {
    const sidechain = basic.result.events.filter((e) => e.sidechain);
    expect(sidechain.map((e) => e.kind)).toEqual(['tool_call', 'cost', 'tool_result', 'test_run']);
  });
});

describe('claude-code adapter, unrecognised input', () => {
  const unknown = processFixture(claudeCode, 'claude-code/unknown-types.jsonl');

  it('reports unknown record and block types with the line they first appear on', () => {
    expect(Object.fromEntries(unknown.result.unknown)).toEqual({
      'line:summary': { count: 1, firstLine: 1 },
      'block:server_tool_use': { count: 1, firstLine: 2 },
    });
  });

  it('reports lines that are not JSON instead of throwing', () => {
    expect(unknown.result.errors).toEqual([{ line: 3, message: 'not valid JSON' }]);
  });
});
