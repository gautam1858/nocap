// Rollout files written by Codex CLI under ~/.codex/sessions/YYYY/MM/DD/.
// Built from the rollout format defined in the openai/codex sources at
// rust-v0.166.0 (codex-rs/history, codex-rs/protocol, codex-rs/rollout).
// Both history modes are handled: "legacy" persists event_msg user_message and
// patch_apply_end; "paginated" persists item_completed TurnItems instead.
import { join } from 'node:path';
import type {
  FileChange,
  NocapEvent,
  ResultStatus,
  SessionInfo,
  ToolCategory,
  TokenUsage,
} from '../core/event.js';
import { detectTestCommand } from './shell.js';
import {
  clip,
  clipChange,
  clipDeep,
  isRecord,
  num,
  optional,
  ParseState,
  str,
  type Adapter,
  type ParseContext,
  type ParsedLine,
  type ParseResult,
} from './types.js';

const LINE_TYPES = new Set([
  'session_meta',
  'response_item',
  'event_msg',
  'turn_context',
  'compacted',
  'token_usage_record',
  'dynamic_tools_updated',
  'inter_agent_communication',
  'inter_agent_communication_metadata',
  'world_state',
  'retained_context',
  'security_risk_score',
  'realtime_item',
]);

const RESPONSE_TYPES = new Set([
  'message',
  'reasoning',
  'function_call',
  'function_call_output',
  'custom_tool_call',
  'custom_tool_call_output',
  'local_shell_call',
  'tool_search_call',
  'tool_search_output',
  'web_search_call',
  'image_generation_call',
  'additional_tools',
  'agent_message',
  'compaction',
  'context_compaction',
  'configuration_update',
]);

// Event types the rollout policy persists (codex-rs/rollout/src/policy.rs).
const EVENT_TYPES = new Set([
  'token_count',
  'thread_goal_updated',
  'thread_rolled_back',
  'turn_aborted',
  'turn_started',
  'turn_complete',
  'thread_settings_applied',
  'user_message',
  'agent_message',
  'agent_reasoning',
  'agent_reasoning_raw_content',
  'entered_review_mode',
  'exited_review_mode',
  'patch_apply_end',
  'context_compacted',
  'mcp_tool_call_end',
  'web_search_end',
  'image_generation_end',
  'sub_agent_activity',
  'item_completed',
]);

const SHELL_TOOLS = new Set([
  'shell',
  'shell_command',
  'exec_command',
  'container.exec',
  'local_shell',
  'write_stdin',
]);

function categorise(name: string, namespace: string | undefined): ToolCategory {
  if (SHELL_TOOLS.has(name)) return 'shell';
  if (name === 'apply_patch') return 'edit';
  if (name === 'web_search') return 'web';
  if (namespace !== undefined || name.startsWith('mcp__')) return 'mcp';
  if (name.includes('agent')) return 'agent';
  return 'other';
}

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** `["bash", "-lc", "npm test"]` runs `npm test`. */
function argvToCommand(argv: unknown): string | undefined {
  if (!Array.isArray(argv) || !argv.every((a) => typeof a === 'string')) return undefined;
  const parts = argv;
  const shellIndex = parts.findIndex((p, i) => i < parts.length - 1 && /^-\w*c$/.test(p));
  if (shellIndex > 0 && /(?:^|\/)(?:ba|z|da|k)?sh$/.test(parts[0] ?? '')) {
    return parts.slice(shellIndex + 1).join(' ');
  }
  return parts.join(' ');
}

function commandOf(name: string, args: unknown): string | undefined {
  if (!isRecord(args)) return undefined;
  if (name === 'exec_command') return str(args.cmd);
  if (name === 'write_stdin') return undefined;
  return str(args.command) ?? argvToCommand(args.command);
}

/** Splits an apply_patch body into per-file changes. */
export function parsePatch(patch: string): FileChange[] {
  const changes: { path: string; op: FileChange['op']; lines: string[]; movedTo?: string }[] = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('*** End Patch')) break;
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      const op = header[1] === 'Add' ? 'create' : header[1] === 'Delete' ? 'delete' : 'update';
      changes.push({ path: (header[2] ?? '').trim(), op, lines: [] });
      continue;
    }
    const current = changes.at(-1);
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (current && move) {
      current.movedTo = (move[1] ?? '').trim();
      current.op = 'move';
    } else if (current) {
      current.lines.push(line);
    }
  }
  return changes.map((c) => ({
    path: c.path,
    op: c.op,
    ...optional('movedTo', c.movedTo),
    ...optional('patch', clipChange(c.lines.join('\n'))),
  }));
}

interface Output {
  readonly text: string;
  readonly exitCode?: number;
  readonly running?: string;
}

/** Reads the exit code from the text Codex hands back to the model for a shell call. */
function readOutput(output: unknown): Output {
  let text = '';
  if (typeof output === 'string') text = output;
  else if (Array.isArray(output)) {
    text = output
      .map((item) => (isRecord(item) ? (str(item.text) ?? '') : ''))
      .filter(Boolean)
      .join('\n');
  } else if (isRecord(output)) text = str(output.content) ?? JSON.stringify(output);

  // Older releases wrapped shell output as JSON with metadata.exit_code.
  const wrapped = text.startsWith('{') ? parseJson(text) : undefined;
  if (
    isRecord(wrapped) &&
    isRecord(wrapped.metadata) &&
    num(wrapped.metadata.exit_code) !== undefined
  ) {
    return {
      text: str(wrapped.output) ?? text,
      ...optional('exitCode', num(wrapped.metadata.exit_code)),
    };
  }
  const exit = /^(?:Exit code: |Process exited with code )(-?\d+)\s*$/m.exec(text);
  const running = /^Process running with session ID (\S+)/m.exec(text);
  return {
    text,
    ...optional('exitCode', exit ? Number(exit[1]) : undefined),
    ...optional('running', running?.[1]),
  };
}

interface Call {
  readonly callId: string;
  readonly name: string;
  readonly command?: string;
  readonly patch?: string;
  readonly args: unknown;
  readonly ts: string;
  readonly line: number;
}

function tokensOf(usage: Record<string, unknown>): TokenUsage {
  const input = num(usage.input_tokens) ?? 0;
  const cached = num(usage.cached_input_tokens) ?? 0;
  return {
    // OpenAI counts cached tokens inside input_tokens; nocap keeps them apart.
    input: Math.max(0, input - cached),
    output: num(usage.output_tokens) ?? 0,
    cacheRead: cached,
    cacheWrite: num(usage.cache_write_input_tokens) ?? 0,
    reasoning: num(usage.reasoning_output_tokens) ?? 0,
  };
}

function fallbackSessionId(file: string): string {
  const match =
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i.exec(file);
  return match?.[1] ?? file;
}

export function parseCodex(input: Iterable<ParsedLine>, context: ParseContext): ParseResult {
  const state = new ParseState();
  const lines = [...input];

  // Pass 1: outcomes that may be recorded before or after the call they belong to.
  const outputs = new Map<string, Output>();
  const patchResults = new Map<string, boolean>();
  const execExitCodes = new Map<string, number>();
  const stdinTargets = new Map<string, string>();
  for (const { value } of lines) {
    if (!isRecord(value) || !isRecord(value.payload)) continue;
    const p = value.payload;
    if (
      value.type === 'response_item' &&
      (p.type === 'function_call_output' || p.type === 'custom_tool_call_output')
    ) {
      const callId = str(p.call_id);
      if (callId) outputs.set(callId, readOutput(p.output));
    } else if (value.type === 'event_msg' && p.type === 'patch_apply_end') {
      const callId = str(p.call_id);
      if (callId && typeof p.success === 'boolean') patchResults.set(callId, p.success);
    } else if (value.type === 'event_msg' && p.type === 'item_completed' && isRecord(p.item)) {
      const item = p.item;
      const id = str(item.id);
      if (id && item.type === 'CommandExecution' && num(item.exit_code) !== undefined) {
        execExitCodes.set(id, num(item.exit_code) ?? 0);
      }
      if (id && item.type === 'FileChange' && typeof item.status === 'string') {
        patchResults.set(id, item.status === 'completed');
      }
    } else if (
      value.type === 'response_item' &&
      p.type === 'function_call' &&
      p.name === 'write_stdin'
    ) {
      const args = parseJson(str(p.arguments));
      const callId = str(p.call_id);
      const target = isRecord(args)
        ? (str(args.session_id) ?? num(args.session_id)?.toString())
        : undefined;
      if (callId && target) stdinTargets.set(callId, target);
    }
  }
  // A long-running exec_command reports "Process running with session ID N";
  // its exit code arrives later in the output of a write_stdin to session N.
  const exitBySession = new Map<string, number>();
  for (const [callId, target] of stdinTargets) {
    const exitCode = outputs.get(callId)?.exitCode;
    if (exitCode !== undefined) exitBySession.set(target, exitCode);
  }

  // Pass 2: events in file order.
  let sessionId = fallbackSessionId(context.file);
  let model: string | undefined;
  let lastTotal = -1;
  let totalIndex: number | undefined;
  const calls = new Map<string, Call>();
  const session: { -readonly [K in keyof SessionInfo]: SessionInfo[K] } = {
    agent: 'codex',
    id: sessionId,
  };
  const models = new Map<string, number>();
  const push = (event: NocapEvent): number => state.events.push(event) - 1;

  for (const { line, value } of lines) {
    state.lines++;
    if (!isRecord(value)) {
      state.errors.push({
        line,
        message: value === undefined ? 'not valid JSON' : 'not a JSON object',
      });
      continue;
    }
    const type = str(value.type) ?? '<no type>';
    const ts = str(value.timestamp) ?? session.endedAt ?? '';
    if (str(value.timestamp)) {
      session.startedAt ??= ts;
      session.endedAt = ts;
    }
    if (!LINE_TYPES.has(type)) {
      state.noteUnknown(`line:${type}`, line);
      continue;
    }
    const p = isRecord(value.payload) ? value.payload : {};
    const base = () => ({ agent: 'codex' as const, sessionId, ts, line });

    if (type === 'session_meta') {
      // A forked or resumed rollout can embed its ancestors' session_meta lines; the first wins.
      if (session.cliVersion === undefined) {
        sessionId = str(p.id) ?? sessionId;
        session.id = sessionId;
        const cwd = str(p.cwd);
        if (cwd !== undefined) session.cwd = cwd;
        const cli = str(p.cli_version);
        if (cli !== undefined) session.cliVersion = cli;
        const branch = isRecord(p.git) ? str(p.git.branch) : undefined;
        if (branch !== undefined) session.gitBranch = branch;
      }
    } else if (type === 'turn_context') {
      model = str(p.model) ?? model;
      if (model) models.set(model, (models.get(model) ?? 0) + 1);
    } else if (type === 'response_item') {
      const itemType = str(p.type) ?? '<no type>';
      if (!RESPONSE_TYPES.has(itemType)) {
        state.noteUnknown(`response_item:${itemType}`, line);
        continue;
      }
      if (itemType === 'message' && p.role === 'assistant') {
        const text = (Array.isArray(p.content) ? p.content : [])
          .map((c) => (isRecord(c) && c.type === 'output_text' ? (str(c.text) ?? '') : ''))
          .join('')
          .trim();
        if (text)
          push({ ...base(), kind: 'claim', payload: { text, ...optional('model', model) } });
      } else if (
        itemType === 'function_call' ||
        itemType === 'custom_tool_call' ||
        itemType === 'local_shell_call'
      ) {
        const callId = str(p.call_id) ?? str(p.id) ?? `line-${String(line)}`;
        const name = itemType === 'local_shell_call' ? 'local_shell' : (str(p.name) ?? 'unknown');
        const args =
          itemType === 'function_call'
            ? (parseJson(str(p.arguments)) ?? str(p.arguments))
            : itemType === 'custom_tool_call'
              ? str(p.input)
              : p.action;
        const command =
          itemType === 'local_shell_call'
            ? isRecord(p.action)
              ? argvToCommand(p.action.command)
              : undefined
            : commandOf(name, args);
        let patch: string | undefined;
        if (name === 'apply_patch')
          patch = typeof args === 'string' ? args : isRecord(args) ? str(args.input) : undefined;
        // Models also run apply_patch through the shell with a heredoc.
        else if (command?.includes('*** Begin Patch')) patch = command;
        const call: Call = {
          callId,
          name,
          args,
          ts,
          line,
          ...optional('command', command),
          ...optional('patch', patch),
        };
        calls.set(callId, call);
        push({
          ...base(),
          kind: 'tool_call',
          payload: {
            callId,
            tool: name,
            category: patch !== undefined ? 'edit' : categorise(name, str(p.namespace)),
            ...optional('command', command),
            input: clipDeep(args),
          },
        });
      } else if (itemType === 'function_call_output' || itemType === 'custom_tool_call_output') {
        const callId = str(p.call_id) ?? `line-${String(line)}`;
        const call = calls.get(callId);
        calls.delete(callId);
        const out = outputs.get(callId) ?? readOutput(p.output);
        const shell = call !== undefined && SHELL_TOOLS.has(call.name);
        let exitCode = out.exitCode;
        if (exitCode === undefined && out.running !== undefined)
          exitCode = exitBySession.get(out.running);
        exitCode ??= execExitCodes.get(callId);
        let status: ResultStatus;
        if (exitCode !== undefined) status = exitCode === 0 ? 'ok' : 'error';
        else if (out.running !== undefined) status = 'background';
        else status = shell ? 'unknown' : 'ok';
        const clipped = clip(out.text);
        push({
          ...base(),
          kind: 'tool_result',
          payload: {
            callId,
            ...optional('tool', call?.name),
            status,
            ...optional('exitCode', exitCode),
            output: clipped.text,
            truncated: clipped.truncated,
          },
        });
        if (call) finish(call, { status, exitCode, text: out.text, ts, line });
      }
    } else if (type === 'event_msg') {
      const eventType = str(p.type) ?? '<no type>';
      if (!EVENT_TYPES.has(eventType)) {
        state.noteUnknown(`event_msg:${eventType}`, line);
        continue;
      }
      if (eventType === 'user_message') {
        const text = str(p.message) ?? '';
        if (text.trim())
          push({ ...base(), kind: 'prompt', payload: { text: clip(text).text, origin: 'human' } });
      } else if (
        eventType === 'item_completed' &&
        isRecord(p.item) &&
        p.item.type === 'UserMessage'
      ) {
        const text = (Array.isArray(p.item.content) ? p.item.content : [])
          .map((c) => (isRecord(c) && c.type === 'text' ? (str(c.text) ?? '') : ''))
          .join('\n');
        if (text.trim())
          push({ ...base(), kind: 'prompt', payload: { text: clip(text).text, origin: 'human' } });
      } else if (eventType === 'token_count' && isRecord(p.info)) {
        const total = isRecord(p.info.total_token_usage) ? p.info.total_token_usage : undefined;
        const last = isRecord(p.info.last_token_usage) ? p.info.last_token_usage : undefined;
        const totalTokens = total ? (num(total.total_tokens) ?? 0) : -1;
        // Codex re-emits token_count with unchanged totals (rate-limit refreshes).
        if (total && last && totalTokens > lastTotal) {
          lastTotal = totalTokens;
          push({
            ...base(),
            kind: 'cost',
            payload: { scope: 'message', ...optional('model', model), tokens: tokensOf(last) },
          });
          const event: NocapEvent = {
            ...base(),
            kind: 'cost',
            payload: {
              scope: 'session-total',
              ...optional('model', model),
              tokens: tokensOf(total),
            },
          };
          if (totalIndex === undefined) totalIndex = push(event);
          else state.events[totalIndex] = event;
        }
      }
    }
  }

  for (const call of calls.values())
    finish(call, { status: 'unknown', ts: call.ts, line: call.line });

  function finish(
    call: Call,
    result: {
      status: ResultStatus;
      exitCode?: number | undefined;
      text?: string;
      ts: string;
      line: number;
    },
  ): void {
    const base = { agent: 'codex' as const, sessionId, ts: result.ts, line: result.line };
    if (call.patch !== undefined) {
      const recorded = patchResults.get(call.callId);
      let status: 'applied' | 'failed' | 'unknown' = 'unknown';
      if (recorded !== undefined) status = recorded ? 'applied' : 'failed';
      else if (result.text !== undefined && /^Success\b/m.test(result.text)) status = 'applied';
      else if (result.text !== undefined && /\b(?:failed|error|invalid patch)\b/i.test(result.text))
        status = 'failed';
      push({
        ...base,
        kind: 'edit',
        payload: { callId: call.callId, tool: call.name, status, changes: parsePatch(call.patch) },
      });
    }
    const test = call.command === undefined ? undefined : detectTestCommand(call.command);
    if (call.command !== undefined && test) {
      push({
        ...base,
        kind: 'test_run',
        payload: {
          callId: call.callId,
          command: call.command,
          segment: test.segment,
          runner: test.runner,
          status: result.status,
          ...optional('exitCode', result.exitCode),
          startedAt: call.ts,
        },
      });
    }
  }

  const topModel = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (topModel !== undefined) session.model = topModel;
  return {
    events: state.events,
    sessions: [session],
    unknown: state.unknown,
    errors: state.errors,
    lines: state.lines,
  };
}

export const codex: Adapter = {
  id: 'codex',
  name: 'Codex CLI',
  roots(env, home) {
    const base = env.CODEX_HOME ?? join(home, '.codex');
    return [join(base, 'sessions'), join(base, 'archived_sessions')];
  },
  isSessionFile(relativePath) {
    return /(?:^|\/)rollout-[^/]+\.jsonl(?:\.zst)?$/.test(relativePath);
  },
  parse: parseCodex,
};
