import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { guardDir } from './paths.js';

export interface GuardConfig {
  /** Block after this many identical tool calls in a row. */
  readonly loopRepeats: number;
  /** Block on this many tool calls within rateWindowSec. 0 disables. */
  readonly rateCalls: number;
  readonly rateWindowSec: number;
  /** Block after this many subagent spawns in a session. */
  readonly subagentFanout: number;
  /** Block a tool call when no human input has arrived for this many minutes. 0 disables. */
  readonly deadMansSwitchMinutes: number;
  /** Turn the guard off entirely (still exits 0, never blocks). */
  readonly disabled: boolean;
}

export const DEFAULT_CONFIG: GuardConfig = {
  loopRepeats: 6,
  rateCalls: 90,
  rateWindowSec: 60,
  subagentFanout: 20,
  deadMansSwitchMinutes: 30,
  disabled: false,
};

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readFileConfig(home: string, env: NodeJS.ProcessEnv): Partial<GuardConfig> {
  const path = join(guardDir({ home, env }), 'config.json');
  if (!existsSync(path)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof raw === 'object' && raw !== null ? raw : {};
  } catch {
    // A broken config must not take the guard down; fall back to defaults.
    return {};
  }
}

export function loadConfig(home: string, env: NodeJS.ProcessEnv): GuardConfig {
  const file = readFileConfig(home, env);
  return {
    loopRepeats: num(env.NOCAP_GUARD_LOOP, num(file.loopRepeats, DEFAULT_CONFIG.loopRepeats)),
    rateCalls: num(env.NOCAP_GUARD_RATE, num(file.rateCalls, DEFAULT_CONFIG.rateCalls)),
    rateWindowSec: num(
      env.NOCAP_GUARD_RATE_WINDOW,
      num(file.rateWindowSec, DEFAULT_CONFIG.rateWindowSec),
    ),
    subagentFanout: num(
      env.NOCAP_GUARD_FANOUT,
      num(file.subagentFanout, DEFAULT_CONFIG.subagentFanout),
    ),
    deadMansSwitchMinutes: num(
      env.NOCAP_GUARD_DEADMAN_MIN,
      num(file.deadMansSwitchMinutes, DEFAULT_CONFIG.deadMansSwitchMinutes),
    ),
    disabled: env.NOCAP_GUARD_OFF === '1' || file.disabled === true,
  };
}
