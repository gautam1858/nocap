import type { AgentId, NocapEvent, SessionInfo } from '../core/event.js';

export interface ParsedLine {
  /** 1-based line number in the file. */
  readonly line: number;
  /** The redacted JSON value, or undefined when the line is not valid JSON. */
  readonly value: unknown;
}

export interface UnknownType {
  readonly count: number;
  readonly firstLine: number;
}

export interface ParseResult {
  readonly events: NocapEvent[];
  readonly sessions: SessionInfo[];
  /** Record types this adapter does not recognise, keyed like "line:foo" or "block:bar". */
  readonly unknown: Map<string, UnknownType>;
  readonly errors: { readonly line: number; readonly message: string }[];
  readonly lines: number;
}

export interface Adapter {
  readonly id: AgentId;
  readonly name: string;
  /** Directories holding session logs, given the environment. Missing ones are skipped. */
  roots(env: NodeJS.ProcessEnv, home: string): string[];
  /** Whether a path relative to a root is a session log this adapter reads. */
  isSessionFile(relativePath: string): boolean;
  parse(lines: Iterable<ParsedLine>, context: ParseContext): ParseResult;
}

export interface ParseContext {
  /** Archive-relative path of the file, used when a line carries no session id. */
  readonly file: string;
}

export class ParseState {
  readonly events: NocapEvent[] = [];
  readonly unknown = new Map<string, UnknownType>();
  readonly errors: { line: number; message: string }[] = [];
  lines = 0;

  noteUnknown(key: string, line: number): void {
    const seen = this.unknown.get(key);
    this.unknown.set(key, { count: (seen?.count ?? 0) + 1, firstLine: seen?.firstLine ?? line });
  }
}

/** Spreads `{ [key]: value }` only when value is defined, for exactOptionalPropertyTypes. */
export function optional<K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

const HEAD = 4 * 1024;
const TAIL = 12 * 1024;

/** Keeps the head and the tail, where test runners print their summaries. */
export function clip(text: string): { text: string; truncated: boolean } {
  if (text.length <= HEAD + TAIL) return { text, truncated: false };
  const elided = text.length - HEAD - TAIL;
  return {
    text: `${text.slice(0, HEAD)}\n[... ${String(elided)} characters elided by nocap ...]\n${text.slice(-TAIL)}`,
    truncated: true,
  };
}

/** Caps every long string inside a tool input; the full text lives in the archive. */
export function clipDeep(value: unknown, max = 8 * 1024): unknown {
  if (typeof value === 'string') {
    return value.length > max ? `${value.slice(0, max)}\n[... truncated by nocap ...]` : value;
  }
  if (Array.isArray(value)) return value.map((v) => clipDeep(v, max));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipDeep(v, max)]));
  }
  return value;
}

const MAX_CHANGE = 64 * 1024;

export function clipChange(text: string | undefined): string | undefined {
  if (text === undefined || text.length <= MAX_CHANGE) return text;
  return `${text.slice(0, MAX_CHANGE)}\n[... truncated by nocap ...]`;
}
