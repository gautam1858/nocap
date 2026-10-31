import type { GuardConfig } from './config.js';
import { checkCommand } from './destructive.js';
import type { GuardEvent } from './input.js';
import { callHash, type GuardState } from './state.js';

export interface Trip {
  readonly rule: string;
  readonly message: string;
}

export interface Evaluation {
  readonly trip?: Trip;
  /** The state to persist after this event. */
  readonly nextState: GuardState;
}

const BLOCK_PREFACE = 'nocap guard blocked this call.';

/**
 * Pure evaluation of one PreToolUse event against the session state and config.
 * Returns a trip (block) or not, plus the state to persist.
 */
export function evaluate(
  event: GuardEvent,
  state: GuardState,
  config: GuardConfig,
  now: number,
): Evaluation {
  const recent = [
    ...state.recent,
    { hash: callHash(event.tool ?? '', event.command, event.input), ts: now },
  ];
  const spawns = state.spawns + (event.isSpawn ? 1 : 0);
  const nextState: GuardState = { ...state, recent, spawns };

  if (config.disabled) return { nextState };

  // 1. Destructive command against a dangerous target.
  if (event.command !== undefined) {
    const danger = checkCommand(event.command, event.cwd);
    if (danger) {
      return {
        trip: { rule: danger.rule, message: `${BLOCK_PREFACE} This looks like ${danger.reason}` },
        nextState,
      };
    }
  }

  // 2. Dead man's switch: autonomous activity with no human input for too long.
  if (config.deadMansSwitchMinutes > 0 && state.lastHumanTs !== undefined) {
    const idleMin = (now - state.lastHumanTs) / 60000;
    if (idleMin >= config.deadMansSwitchMinutes) {
      return {
        trip: {
          rule: 'dead-mans-switch',
          message: `${BLOCK_PREFACE} No human input for ${idleMin.toFixed(0)} minutes while still running tools. Check in before it keeps going.`,
        },
        nextState,
      };
    }
  }

  // 3. Identical-call loop.
  const lastHash = recent[recent.length - 1]?.hash;
  let repeats = 0;
  for (let i = recent.length - 1; i >= 0 && recent[i]?.hash === lastHash; i--) repeats++;
  if (repeats >= config.loopRepeats) {
    return {
      trip: {
        rule: 'identical-loop',
        message: `${BLOCK_PREFACE} The same call has run ${String(repeats)} times in a row with no change. This is a loop.`,
      },
      nextState,
    };
  }

  // 4. Subagent fan-out.
  if (event.isSpawn && config.subagentFanout > 0 && spawns >= config.subagentFanout) {
    return {
      trip: {
        rule: 'subagent-fanout',
        message: `${BLOCK_PREFACE} ${String(spawns)} subagents have been spawned in this session. That is a fan-out.`,
      },
      nextState,
    };
  }

  // 5. Spend/token velocity, approximated by call rate.
  if (config.rateCalls > 0) {
    const windowStart = now - config.rateWindowSec * 1000;
    const inWindow = recent.filter((r) => r.ts >= windowStart).length;
    if (inWindow >= config.rateCalls) {
      return {
        trip: {
          rule: 'velocity',
          message: `${BLOCK_PREFACE} ${String(inWindow)} tool calls in ${String(config.rateWindowSec)}s. This is running away.`,
        },
        nextState,
      };
    }
  }

  return { nextState };
}
