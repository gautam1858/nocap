import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type GuardConfig } from '../../src/guard/config.js';
import type { GuardEvent } from '../../src/guard/input.js';
import { evaluate } from '../../src/guard/rules.js';
import { callHash, type GuardState } from '../../src/guard/state.js';

const config: GuardConfig = { ...DEFAULT_CONFIG };

function pre(command: string, extra: Partial<GuardEvent> = {}): GuardEvent {
  return {
    hookEvent: 'PreToolUse',
    agent: 'claude-code',
    sessionId: 's',
    cwd: '/home/dev/app',
    tool: 'Bash',
    command,
    input: { command },
    isSpawn: false,
    ...extra,
  };
}

function emptyState(): GuardState {
  return { recent: [], spawns: 0 };
}

describe('guard rules', () => {
  it('blocks a destructive command and records state', () => {
    const { trip, nextState } = evaluate(pre('rm -rf /'), emptyState(), config, 1000);
    expect(trip?.rule).toBe('destructive-rm');
    expect(nextState.recent).toHaveLength(1);
  });

  it('allows an ordinary command', () => {
    expect(evaluate(pre('npm test'), emptyState(), config, 1000).trip).toBeUndefined();
  });

  it('blocks an identical-call loop at the threshold', () => {
    let state = emptyState();
    let trip;
    for (let i = 0; i < config.loopRepeats; i++) {
      const r = evaluate(pre('npm run build'), state, config, 1000 + i);
      state = r.nextState;
      trip = r.trip;
    }
    expect(trip?.rule).toBe('identical-loop');
  });

  it('does not count different commands as a loop', () => {
    let state = emptyState();
    let trip;
    for (let i = 0; i < config.loopRepeats + 2; i++) {
      const r = evaluate(pre(`echo ${String(i)}`), state, config, 1000 + i);
      state = r.nextState;
      trip = r.trip;
    }
    expect(trip).toBeUndefined();
  });

  it('blocks subagent fan-out', () => {
    const state: GuardState = { recent: [], spawns: config.subagentFanout - 1 };
    const spawn: GuardEvent = {
      hookEvent: 'PreToolUse',
      agent: 'claude-code',
      sessionId: 's',
      tool: 'Task',
      input: {},
      isSpawn: true,
    };
    expect(evaluate(spawn, state, config, 1000).trip?.rule).toBe('subagent-fanout');
  });

  it('trips the dead-man switch after the idle window', () => {
    const state: GuardState = { recent: [], spawns: 0, lastHumanTs: 0 };
    const now = config.deadMansSwitchMinutes * 60000 + 1;
    expect(evaluate(pre('npm test'), state, config, now).trip?.rule).toBe('dead-mans-switch');
  });

  it('does not trip the dead-man switch without a recorded human input', () => {
    const now = config.deadMansSwitchMinutes * 60000 + 1;
    expect(evaluate(pre('npm test'), emptyState(), config, now).trip).toBeUndefined();
  });

  it('blocks on call-rate velocity', () => {
    const tight: GuardConfig = { ...config, rateCalls: 5, rateWindowSec: 10 };
    let state = emptyState();
    let trip;
    for (let i = 0; i < 5; i++) {
      const r = evaluate(pre(`cmd ${String(i)}`), state, tight, 1000 + i);
      state = r.nextState;
      trip = r.trip;
    }
    expect(trip?.rule).toBe('velocity');
  });

  it('allows everything when disabled', () => {
    expect(
      evaluate(pre('rm -rf /'), emptyState(), { ...config, disabled: true }, 1000).trip,
    ).toBeUndefined();
  });

  it('hashes identical calls to the same value', () => {
    expect(callHash('Bash', 'npm test', {})).toBe(callHash('Bash', 'npm test', {}));
    expect(callHash('Bash', 'npm test', {})).not.toBe(callHash('Bash', 'npm run build', {}));
  });
});
