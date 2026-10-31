import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentId } from '../core/event.js';
import { Redactor } from '../redact/redactor.js';
import { nearMissLog, type GuardEnv } from './paths.js';

export interface NearMiss {
  readonly ts: string;
  readonly agent: AgentId | 'unknown';
  readonly sessionId: string;
  readonly rule: string;
  readonly message: string;
  readonly tool?: string;
}

/** Appends a near miss, with the message scrubbed of secrets and home paths. */
export function recordNearMiss(e: GuardEnv, miss: NearMiss): void {
  const redactor = new Redactor({ home: e.home });
  const scrubbed: NearMiss = {
    ...miss,
    message: redactor.text(miss.message),
    ...(miss.tool !== undefined ? { tool: miss.tool } : {}),
  };
  const file = nearMissLog(e);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(scrubbed)}\n`, { mode: 0o600 });
}

export function readNearMisses(e: GuardEnv): NearMiss[] {
  const file = nearMissLog(e);
  if (!existsSync(file)) return [];
  const misses: NearMiss[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      misses.push(JSON.parse(line) as NearMiss);
    } catch {
      // Skip a corrupt line rather than failing the whole read.
    }
  }
  return misses;
}

export function nearMissesForSession(e: GuardEnv, sessionId: string): NearMiss[] {
  return readNearMisses(e).filter((m) => m.sessionId === sessionId);
}
