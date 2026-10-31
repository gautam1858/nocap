import { loadConfig } from './config.js';
import { parseGuardInput } from './input.js';
import { recordNearMiss } from './nearmiss.js';
import type { GuardEnv } from './paths.js';
import { evaluate } from './rules.js';
import { readState, writeState } from './state.js';

export interface GuardOutcome {
  /** 0 allows the tool call; 2 blocks it. The guard never exits 1 (that fails open). */
  readonly exitCode: 0 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const ALLOW: GuardOutcome = { exitCode: 0, stdout: '', stderr: '' };

function deny(reason: string): GuardOutcome {
  const json = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
  return { exitCode: 2, stdout: `${json}\n`, stderr: `${reason}\n` };
}

/**
 * The guard's whole decision for one hook invocation. Pure except for the state
 * and near-miss files it reads and writes. Fails closed: any unexpected error
 * blocks, unless the user has explicitly turned the guard off.
 */
export function runGuard(stdin: string, e: GuardEnv, now: number = Date.now()): GuardOutcome {
  // An explicit off switch overrides everything, including fail-closed.
  if (e.env.NOCAP_GUARD_OFF === '1') return ALLOW;

  try {
    const config = loadConfig(e.home, e.env);
    if (config.disabled) return ALLOW;

    const event = parseGuardInput(stdin);
    if (!event) {
      return deny(
        'nocap guard could not parse the hook input, so it blocked the call to be safe. See https://github.com/gautam1858/nocap for the hook contract.',
      );
    }

    if (event.hookEvent === 'UserPromptSubmit') {
      const state = readState(e, event.sessionId);
      writeState(e, event.sessionId, { ...state, lastHumanTs: now });
      return ALLOW;
    }

    if (event.hookEvent !== 'PreToolUse') return ALLOW;

    const state = readState(e, event.sessionId);
    const { trip, nextState } = evaluate(event, state, config, now);
    writeState(e, event.sessionId, nextState);
    if (!trip) return ALLOW;

    recordNearMiss(e, {
      ts: new Date(now).toISOString(),
      agent: event.agent,
      sessionId: event.sessionId,
      rule: trip.rule,
      message: trip.message,
      ...(event.tool !== undefined ? { tool: event.tool } : {}),
    });
    return deny(trip.message);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return deny(`nocap guard hit an internal error and blocked the call to be safe: ${detail}`);
  }
}
