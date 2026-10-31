import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { stateDir, type GuardEnv } from './paths.js';

export interface CallRecord {
  readonly hash: string;
  readonly ts: number;
}

export interface GuardState {
  lastHumanTs?: number;
  recent: CallRecord[];
  spawns: number;
}

const MAX_RECENT = 64;

function emptyState(): GuardState {
  return { recent: [], spawns: 0 };
}

function stateFile(e: GuardEnv, sessionId: string): string {
  // The session id comes from the agent; hash it so an odd value can't escape the directory.
  const safe = createHash('sha256').update(sessionId).digest('hex').slice(0, 32);
  return join(stateDir(e), `${safe}.json`);
}

export function readState(e: GuardEnv, sessionId: string): GuardState {
  const file = stateFile(e, sessionId);
  if (!existsSync(file)) return emptyState();
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<GuardState>;
    return {
      ...(typeof raw.lastHumanTs === 'number' ? { lastHumanTs: raw.lastHumanTs } : {}),
      recent: Array.isArray(raw.recent) ? raw.recent.slice(-MAX_RECENT) : [],
      spawns: typeof raw.spawns === 'number' ? raw.spawns : 0,
    };
  } catch {
    return emptyState();
  }
}

export function writeState(e: GuardEnv, sessionId: string, state: GuardState): void {
  const file = stateFile(e, sessionId);
  mkdirSync(stateDir(e), { recursive: true, mode: 0o700 });
  const trimmed: GuardState = { ...state, recent: state.recent.slice(-MAX_RECENT) };
  const tmp = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, JSON.stringify(trimmed), { mode: 0o600 });
  renameSync(tmp, file);
}

export function callHash(tool: string, command: string | undefined, input: unknown): string {
  const key = command ?? safeStringify(input);
  return createHash('sha256').update(`${tool}\u0000${key}`).digest('hex').slice(0, 16);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
