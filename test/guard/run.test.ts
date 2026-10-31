import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGuard } from '../../src/guard/run.js';
import { nearMissLog, type GuardEnv } from '../../src/guard/paths.js';

let home: string;
let e: GuardEnv;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nocap-guard-'));
  e = { home, env: { HOME: home, NOCAP_HOME: join(home, '.nocap') } };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const pre = (command: string) =>
  JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's1',
    cwd: '/home/dev/app',
    tool_name: 'Bash',
    tool_input: { command },
  });

describe('runGuard', () => {
  it('allows an ordinary call (exit 0)', () => {
    expect(runGuard(pre('npm test'), e).exitCode).toBe(0);
  });

  it('blocks a destructive call (exit 2) with a deny decision and logs a near miss', () => {
    const outcome = runGuard(pre('rm -rf /'), e);
    expect(outcome.exitCode).toBe(2);
    expect(outcome.stdout).toContain('"permissionDecision":"deny"');
    expect(outcome.stderr).toContain('rm -rf');
    const log = readFileSync(nearMissLog(e), 'utf8');
    expect(log).toContain('destructive-rm');
  });

  it('fails closed on unparseable input', () => {
    expect(runGuard('not json', e).exitCode).toBe(2);
    expect(runGuard('', e).exitCode).toBe(2);
    expect(runGuard('{"unexpected": true}', e).exitCode).toBe(2);
  });

  it('respects the explicit off switch, even on garbage input', () => {
    const off = { home, env: { ...e.env, NOCAP_GUARD_OFF: '1' } };
    expect(runGuard('not json', off).exitCode).toBe(0);
    expect(runGuard(pre('rm -rf /'), off).exitCode).toBe(0);
  });

  it('records human input from UserPromptSubmit and clears a dead-man condition', () => {
    const t0 = Date.parse('2026-10-30T09:00:00.000Z');
    const submit = JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's2' });
    runGuard(submit, { ...e, env: { ...e.env, NOCAP_GUARD_DEADMAN_MIN: '30' } }, t0);
    const preS2 = JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's2',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    // 10 minutes later: still within the window.
    expect(
      runGuard(preS2, { ...e, env: { ...e.env, NOCAP_GUARD_DEADMAN_MIN: '30' } }, t0 + 10 * 60000)
        .exitCode,
    ).toBe(0);
    // 31 minutes later: trips.
    expect(
      runGuard(preS2, { ...e, env: { ...e.env, NOCAP_GUARD_DEADMAN_MIN: '30' } }, t0 + 31 * 60000)
        .exitCode,
    ).toBe(2);
  });

  it('redacts secrets from the near-miss log', () => {
    const cmd = `psql "postgres://admin:${'pw' + 'hunter2hunter2'}@db/prod" -c "DROP TABLE users"`;
    runGuard(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 's3',
        tool_name: 'Bash',
        tool_input: { command: cmd },
      }),
      e,
    );
    if (existsSync(nearMissLog(e))) {
      expect(readFileSync(nearMissLog(e), 'utf8')).not.toContain('hunter2hunter2');
    }
  });

  it('parses a Codex-style local shell payload', () => {
    const codex = JSON.stringify({
      hook_event_name: 'PreToolUse',
      thread_id: 't1',
      tool_name: 'local_shell',
      tool_input: { action: { command: ['bash', '-lc', 'rm -rf /etc'] } },
    });
    expect(runGuard(codex, e).exitCode).toBe(2);
  });
});
