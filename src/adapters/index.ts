import type { AgentId } from '../core/event.js';
import { claudeCode } from './claude-code.js';
import { codex } from './codex.js';
import type { Adapter } from './types.js';

export const adapters: readonly Adapter[] = [claudeCode, codex];

/** Bump when adapter output changes, so stored sessions are re-indexed from the archive. */
export const PARSER_VERSION = 1;

export function adapterFor(agent: AgentId): Adapter {
  const adapter = adapters.find((a) => a.id === agent);
  if (!adapter) throw new Error(`no adapter for ${agent}`);
  return adapter;
}
