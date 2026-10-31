// Session logs written by Claude Code under ~/.claude/projects/<encoded-cwd>/.
// Built from transcripts written by version 2.1.316; see fixtures/claude-code/.
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

// Record types seen in real transcripts that carry nothing nocap needs, or that
// duplicate information found elsewhere (queue-operation repeats prompts).
const IGNORED_LINES = new Set([
  'system',
  'queue-operation',
  'tools-used',
  'atis-latch',
  'last-prompt',
  'mode',
]);

// Anthropic Messages API content block types.
const IGNORED_BLOCKS = new Set(['thinking', 'redacted_thinking', 'image', 'document']);

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

function categorise(tool: string): ToolCategory {
  if (tool === 'Bash' || tool === 'BashOutput' || tool === 'KillShell') return 'shell';
  if (EDIT_TOOLS.has(tool)) return 'edit';
  if (tool === 'Read' || tool === 'NotebookRead') return 'read';
  if (tool === 'Grep' || tool === 'Glob' || tool === 'LS') return 'search';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'web';
  if (tool === 'Task' || tool === 'Agent') return 'agent';
  if (tool.startsWith('mcp__')) return 'mcp';
  return 'other';
}

// Harness-injected text in older transcripts that predate the `origin` field.
const SYNTHETIC_PREFIX =
  /^\s*<(?:system-reminder|task-notification|local-command-stdout|local-command-stderr)>/;

function promptOrigin(record: Record<string, unknown>, text: string): 'human' | 'system' {
  const origin = record.origin;
  if (isRecord(origin)) return origin.kind === 'human' ? 'human' : 'system';
  if (record.isMeta === true || SYNTHETIC_PREFIX.test(text)) return 'system';
  return record.userType === 'external' || record.userType === undefined ? 'human' : 'system';
}

function blockText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => (isRecord(part) && part.type === 'text' ? (str(part.text) ?? '') : ''))
    .filter((t) => t.length > 0)
    .join('\n');
}

function usageOf(usage: Record<string, unknown>): TokenUsage {
  return {
    input: num(usage.input_tokens) ?? 0,
    output: num(usage.output_tokens) ?? 0,
    cacheRead: num(usage.cache_read_input_tokens) ?? 0,
    cacheWrite: num(usage.cache_creation_input_tokens) ?? 0,
  };
}

function changesFor(tool: string, input: Record<string, unknown>, result: unknown): FileChange[] {
  const path = str(input.file_path) ?? str(input.notebook_path) ?? '';
  switch (tool) {
    case 'Edit':
      return [
        {
          path,
          op: 'update',
          ...optional('before', clipChange(str(input.old_string))),
          ...optional('after', clipChange(str(input.new_string))),
        },
      ];
    case 'MultiEdit':
      return (Array.isArray(input.edits) ? input.edits : []).filter(isRecord).map((edit) => ({
        path,
        op: 'update' as const,
        ...optional('before', clipChange(str(edit.old_string))),
        ...optional('after', clipChange(str(edit.new_string))),
      }));
    case 'Write': {
      const type = isRecord(result) ? result.type : undefined;
      const before = isRecord(result) ? str(result.originalFile) : undefined;
      return [
        {
          path,
          op: type === 'create' ? 'create' : 'update',
          ...optional('before', clipChange(before)),
          ...optional('after', clipChange(str(input.content))),
        },
      ];
    }
    default:
      return [{ path, op: 'update', ...optional('after', clipChange(str(input.new_source))) }];
  }
}

interface PendingCall {
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly command?: string;
  readonly ts: string;
  readonly line: number;
  readonly sessionId: string;
  readonly sidechain: boolean;
}

class SessionBuilder {
  cwd: string | undefined;
  cliVersion: string | undefined;
  gitBranch: string | undefined;
  startedAt: string | undefined;
  endedAt: string | undefined;
  readonly models = new Map<string, number>();
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  see(record: Record<string, unknown>, ts: string | undefined): void {
    this.cwd ??= str(record.cwd);
    this.cliVersion = str(record.version) ?? this.cliVersion;
    this.gitBranch = str(record.gitBranch) ?? this.gitBranch;
    if (ts) {
      if (!this.startedAt || ts < this.startedAt) this.startedAt = ts;
      if (!this.endedAt || ts > this.endedAt) this.endedAt = ts;
    }
  }

  build(): SessionInfo {
    const model = [...this.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
      agent: 'claude-code',
      id: this.id,
      ...optional('cwd', this.cwd),
      ...optional('cliVersion', this.cliVersion),
      ...optional('model', model),
      ...optional('gitBranch', this.gitBranch),
      ...optional('startedAt', this.startedAt),
      ...optional('endedAt', this.endedAt),
    };
  }
}

function fallbackSessionId(file: string): string {
  const base = file.split('/').pop() ?? file;
  return base.replace(/\.jsonl(?:\.zst)?$/, '');
}

export function parseClaudeCode(lines: Iterable<ParsedLine>, context: ParseContext): ParseResult {
  const state = new ParseState();
  const sessions = new Map<string, SessionBuilder>();
  const pending = new Map<string, PendingCall>();
  // Streaming writes one line per content block, each repeating the message
  // usage. One cost event per message, updated to the latest usage seen.
  const costIndex = new Map<string, number>();
  let sessionTotalIndex: number | undefined;
  let lastTs = '';
  let lastSession = fallbackSessionId(context.file);

  const push = (event: NocapEvent): number => state.events.push(event) - 1;

  const finishCall = (
    callId: string,
    call: PendingCall,
    result: { status: ResultStatus; exitCode?: number; ts: string; line: number; raw?: unknown },
  ): void => {
    const base = {
      agent: 'claude-code' as const,
      sessionId: call.sessionId,
      ts: result.ts,
      line: result.line,
      ...(call.sidechain ? { sidechain: true as const } : {}),
    };
    if (EDIT_TOOLS.has(call.tool)) {
      push({
        ...base,
        kind: 'edit',
        payload: {
          callId,
          tool: call.tool,
          status:
            result.status === 'ok' ? 'applied' : result.status === 'unknown' ? 'unknown' : 'failed',
          changes: changesFor(call.tool, call.input, result.raw),
        },
      });
    }
    const test = call.command === undefined ? undefined : detectTestCommand(call.command);
    if (call.command !== undefined && test) {
      push({
        ...base,
        kind: 'test_run',
        payload: {
          callId,
          command: call.command,
          segment: test.segment,
          runner: test.runner,
          status: result.status,
          ...optional('exitCode', result.exitCode),
          startedAt: call.ts,
        },
      });
    }
  };

  for (const { line, value } of lines) {
    state.lines++;
    if (!isRecord(value)) {
      state.errors.push({
        line,
        message: value === undefined ? 'not valid JSON' : 'not a JSON object',
      });
      continue;
    }
    const type = str(value.type);
    const ts = str(value.timestamp) ?? lastTs;
    if (str(value.timestamp)) lastTs = ts;
    const sessionId = str(value.sessionId) ?? lastSession;
    lastSession = sessionId;
    const sidechain = value.isSidechain === true;
    const base = {
      agent: 'claude-code' as const,
      sessionId,
      ts,
      line,
      ...(sidechain ? { sidechain: true as const } : {}),
    };

    let session = sessions.get(sessionId);
    if (!session) sessions.set(sessionId, (session = new SessionBuilder(sessionId)));
    session.see(value, str(value.timestamp));

    if (type === 'assistant' && isRecord(value.message)) {
      const message = value.message;
      const model = str(message.model);
      if (model && model !== '<synthetic>')
        session.models.set(model, (session.models.get(model) ?? 0) + 1);
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!isRecord(block)) continue;
        const blockType = str(block.type) ?? '<none>';
        if (blockType === 'text') {
          const text = str(block.text)?.trim();
          if (text)
            push({ ...base, kind: 'claim', payload: { text, ...optional('model', model) } });
        } else if (blockType === 'tool_use') {
          const callId = str(block.id) ?? `line-${String(line)}`;
          const tool = str(block.name) ?? 'unknown';
          const input = isRecord(block.input) ? block.input : {};
          const category = categorise(tool);
          const command = tool === 'Bash' ? str(input.command) : undefined;
          pending.set(callId, {
            tool,
            input,
            ...optional('command', command),
            ts,
            line,
            sessionId,
            sidechain,
          });
          push({
            ...base,
            kind: 'tool_call',
            payload: {
              callId,
              tool,
              category,
              ...optional('command', command),
              input: clipDeep(input),
            },
          });
        } else if (!IGNORED_BLOCKS.has(blockType)) {
          state.noteUnknown(`block:${blockType}`, line);
        }
      }
      if (isRecord(message.usage)) {
        const key = `${str(message.id) ?? ''}:${str(value.requestId) ?? ''}`;
        const event: NocapEvent = {
          ...base,
          kind: 'cost',
          payload: {
            scope: 'message',
            ...optional('model', model),
            tokens: usageOf(message.usage),
          },
        };
        const index = costIndex.get(key);
        if (index === undefined) costIndex.set(key, push(event));
        else
          state.events[index] = {
            ...event,
            ts: state.events[index]?.ts ?? ts,
            line: state.events[index]?.line ?? line,
          };
      }
    } else if (type === 'user' && isRecord(value.message)) {
      const content = value.message.content;
      if (typeof content === 'string') {
        if (content.trim()) {
          push({
            ...base,
            kind: 'prompt',
            payload: { text: clip(content).text, origin: promptOrigin(value, content) },
          });
        }
        continue;
      }
      for (const block of Array.isArray(content) ? content : []) {
        if (!isRecord(block)) continue;
        const blockType = str(block.type) ?? '<none>';
        if (blockType === 'text') {
          const text = str(block.text) ?? '';
          if (text.trim()) {
            push({
              ...base,
              kind: 'prompt',
              payload: { text: clip(text).text, origin: promptOrigin(value, text) },
            });
          }
        } else if (blockType === 'tool_result') {
          const callId = str(block.tool_use_id) ?? `line-${String(line)}`;
          const call = pending.get(callId);
          pending.delete(callId);
          const text = blockText(block.content);
          const raw = value.toolUseResult;
          const isError = block.is_error === true;
          let status: ResultStatus = isError ? 'error' : 'ok';
          let exitCode: number | undefined;
          if (call?.tool === 'Bash') {
            const exit = /^(?:Error: )?Exit code (-?\d+)/.exec(text);
            if (exit) exitCode = Number(exit[1]);
            else if (!isError) exitCode = 0;
            if (isRecord(raw) && raw.interrupted === true) {
              status = 'interrupted';
              exitCode = undefined;
            } else if (
              call.input.run_in_background === true ||
              (isRecord(raw) && typeof raw.backgroundTaskId === 'string')
            ) {
              status = 'background';
              exitCode = undefined;
            }
          }
          const output = clip(text);
          push({
            ...base,
            kind: 'tool_result',
            payload: {
              callId,
              ...optional('tool', call?.tool),
              status,
              ...optional('exitCode', exitCode),
              output: output.text,
              truncated: output.truncated,
            },
          });
          if (call)
            finishCall(callId, call, { status, ...optional('exitCode', exitCode), ts, line, raw });
        } else if (!IGNORED_BLOCKS.has(blockType)) {
          state.noteUnknown(`block:${blockType}`, line);
        }
      }
    } else if (type === 'attachment') {
      const attachment = value.attachment;
      // Messages typed while the agent was mid-turn arrive only as queued commands.
      if (isRecord(attachment) && attachment.type === 'queued_command') {
        const text = str(attachment.prompt) ?? '';
        const origin =
          isRecord(attachment.origin) && attachment.origin.kind === 'human' ? 'human' : 'system';
        if (text.trim()) {
          push({
            ...base,
            ts: str(attachment.timestamp) ?? ts,
            kind: 'prompt',
            payload: { text: clip(text).text, origin },
          });
        }
      }
    } else if (type === 'cost-state') {
      const usage = isRecord(value.modelUsage) ? value.modelUsage : {};
      const models = Object.keys(usage);
      const tokens = Object.values(usage)
        .filter(isRecord)
        .reduce<TokenUsage>(
          (sum, m) => ({
            input: sum.input + (num(m.inputTokens) ?? 0),
            output: sum.output + (num(m.outputTokens) ?? 0),
            cacheRead: sum.cacheRead + (num(m.cacheReadInputTokens) ?? 0),
            cacheWrite: sum.cacheWrite + (num(m.cacheCreationInputTokens) ?? 0),
          }),
          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        );
      const usd = num(value.totalCostUSD);
      const event: NocapEvent = {
        ...base,
        kind: 'cost',
        payload: {
          scope: 'session-total',
          ...optional('model', models.length === 1 ? models[0] : undefined),
          tokens,
          ...optional('usd', usd),
        },
      };
      if (sessionTotalIndex === undefined) sessionTotalIndex = push(event);
      else state.events[sessionTotalIndex] = event;
    } else if (type === undefined) {
      state.noteUnknown('line:<no type>', line);
    } else if (!IGNORED_LINES.has(type) && type !== 'user' && type !== 'assistant') {
      state.noteUnknown(`line:${type}`, line);
    }
  }

  // Calls that never got a result: the session ended or crashed mid-tool.
  for (const [callId, call] of pending) {
    finishCall(callId, call, { status: 'unknown', ts: call.ts, line: call.line });
  }

  return {
    events: state.events,
    sessions: [...sessions.values()].map((s) => s.build()),
    unknown: state.unknown,
    errors: state.errors,
    lines: state.lines,
  };
}

export const claudeCode: Adapter = {
  id: 'claude-code',
  name: 'Claude Code',
  roots(env, home) {
    const base = env.CLAUDE_CONFIG_DIR ?? join(home, '.claude');
    return [join(base, 'projects')];
  },
  isSessionFile(relativePath) {
    return relativePath.endsWith('.jsonl');
  },
  parse: parseClaudeCode,
};
