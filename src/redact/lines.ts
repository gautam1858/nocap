import { isRecord } from '../adapters/types.js';
import { isSecretsPath, printsSecrets, type Redactor } from './redactor.js';

// Tool-call record types across agents: Anthropic tool_use blocks, Codex
// function, custom and local shell calls.
const CALL_TYPES = new Set(['tool_use', 'function_call', 'custom_tool_call', 'local_shell_call']);
const RESULT_ID_FIELDS = ['tool_use_id', 'call_id'] as const;
const PATH_FIELDS = new Set(['file_path', 'filePath', 'path', 'notebook_path']);
const COMMAND_FIELDS = new Set(['command', 'cmd', 'script']);

function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) yield* nodes(item);
  else if (isRecord(value)) {
    yield value;
    for (const item of Object.values(value)) yield* nodes(item);
  }
}

function parseIfJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('{')) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

/** Whether a tool call's input reads a secrets file or dumps the environment. */
function callTouchesSecrets(call: Record<string, unknown>): boolean {
  const input = call.input ?? parseIfJson(call.arguments) ?? call.action;
  for (const node of nodes(input)) {
    for (const [key, value] of Object.entries(node)) {
      if (PATH_FIELDS.has(key) && typeof value === 'string' && isSecretsPath(value)) return true;
      if (COMMAND_FIELDS.has(key)) {
        const command = Array.isArray(value)
          ? value.filter((v) => typeof v === 'string').join(' ')
          : value;
        if (typeof command === 'string' && printsSecrets(command)) return true;
      }
    }
  }
  // Codex passes apply_patch and some shells a bare string.
  return typeof input === 'string' && printsSecrets(input);
}

export interface RedactedLine {
  readonly text: string;
  readonly value: unknown;
}

/**
 * Redacts a session log one line at a time. A tool call that prints a secrets
 * file (`cat .env`, a Read of `.env.local`, `printenv`) marks its call id, and
 * the line holding that call's result is scrubbed as a secrets file: every
 * KEY=value loses its value, whatever the key is called.
 */
export class LineRedactor {
  readonly #sensitiveIds = new Set<string>();
  readonly #redactor: Redactor;

  constructor(redactor: Redactor) {
    this.#redactor = redactor;
  }

  line(raw: string): RedactedLine {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { text: this.#redactor.text(raw), value: undefined };
    }
    let sensitive = false;
    for (const node of nodes(parsed)) {
      if (typeof node.type === 'string' && CALL_TYPES.has(node.type) && callTouchesSecrets(node)) {
        const id = node.id ?? node.call_id;
        if (typeof id === 'string') this.#sensitiveIds.add(id);
        sensitive = true;
      }
      for (const field of RESULT_ID_FIELDS) {
        const id = node[field];
        if (typeof id === 'string' && this.#sensitiveIds.has(id)) sensitive = true;
      }
      // A Read result names the file it read.
      for (const key of PATH_FIELDS) {
        const value = node[key];
        if (typeof value === 'string' && isSecretsPath(value)) sensitive = true;
      }
    }
    const before = this.#redactor.changes;
    const value = this.#redactor.value(parsed, sensitive);
    return { text: this.#redactor.changes === before ? raw : JSON.stringify(value), value };
  }
}
