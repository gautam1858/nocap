import { isRecord, str } from '../adapters/types.js';
import type { AgentId } from '../core/event.js';

export type HookEvent = 'PreToolUse' | 'UserPromptSubmit' | 'Stop' | 'other';

export interface GuardEvent {
  readonly hookEvent: HookEvent;
  readonly agent: AgentId | 'unknown';
  readonly sessionId: string;
  readonly cwd?: string;
  readonly tool?: string;
  readonly command?: string;
  readonly input: unknown;
  /** True when the tool spawns a subagent. */
  readonly isSpawn: boolean;
}

const SPAWN_TOOLS = new Set(['Task', 'Agent', 'spawn_agent', 'agent', 'subagent']);

function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function hookEventOf(name: string | undefined): HookEvent {
  if (name === 'PreToolUse' || name === 'UserPromptSubmit' || name === 'Stop') return name;
  return 'other';
}

/** The shell command inside a tool input, across the shapes Claude Code and Codex use. */
function commandOf(_tool: string | undefined, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const direct = str(input.command) ?? str(input.cmd) ?? str(input.script);
  if (direct !== undefined) return direct;
  // Codex local_shell: { action: { command: ["bash","-lc","..."] } } or argv arrays.
  const argvSource = isRecord(input.action) ? input.action.command : input.command;
  if (Array.isArray(argvSource) && argvSource.every((a) => typeof a === 'string')) {
    const parts: string[] = argvSource;
    const shellIndex = parts.findIndex((p, i) => i < parts.length - 1 && /^-\w*c$/.test(p));
    return shellIndex >= 0 ? parts.slice(shellIndex + 1).join(' ') : parts.join(' ');
  }
  return undefined;
}

/**
 * Parses a hook's stdin JSON into a normalised event. Returns undefined when the
 * input is not a usable hook payload, so the caller can fail closed.
 */
export function parseGuardInput(raw: string): GuardEvent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const eventName = str(pick(parsed, ['hook_event_name', 'hookEventName', 'event', 'hook_event']));
  const hookEvent = hookEventOf(eventName);
  const sessionId =
    str(pick(parsed, ['session_id', 'sessionId', 'sessionID', 'conversation_id', 'thread_id'])) ??
    'unknown';
  const cwd = str(pick(parsed, ['cwd', 'workdir', 'working_directory', 'project_dir']));
  const tool = str(pick(parsed, ['tool_name', 'toolName', 'tool', 'name']));
  const inputRaw = pick(parsed, ['tool_input', 'toolInput', 'input', 'arguments', 'params']);
  const input =
    typeof inputRaw === 'string' && inputRaw.startsWith('{') ? safeParse(inputRaw) : inputRaw;
  const originator = str(pick(parsed, ['originator', 'client', 'app']));
  const agent: GuardEvent['agent'] =
    originator?.includes('codex') || 'thread_id' in parsed
      ? 'codex'
      : 'transcript_path' in parsed || tool !== undefined
        ? 'claude-code'
        : 'unknown';
  const command = commandOf(tool, input);

  // Neither a hook event name nor a tool means this is not a hook payload we
  // understand; returning undefined lets the caller fail closed.
  if (eventName === undefined && tool === undefined) return undefined;

  return {
    hookEvent,
    agent,
    sessionId,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(tool !== undefined ? { tool } : {}),
    ...(command !== undefined ? { command } : {}),
    input,
    isSpawn: tool !== undefined && SPAWN_TOOLS.has(tool),
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
