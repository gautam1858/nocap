export type AgentId = 'claude-code' | 'codex';

export const AGENTS: readonly AgentId[] = ['claude-code', 'codex'];

export type EventKind =
  'prompt' | 'claim' | 'tool_call' | 'tool_result' | 'edit' | 'test_run' | 'cost';

export interface PromptPayload {
  readonly text: string;
  /** Whether a person typed it, or the harness injected it (task notifications and the like). */
  readonly origin: 'human' | 'system';
}

/** Assistant prose. The polygraph decides which sentences in it are claims. */
export interface ClaimPayload {
  readonly text: string;
  readonly model?: string;
}

export type ToolCategory = 'shell' | 'edit' | 'read' | 'search' | 'web' | 'agent' | 'mcp' | 'other';

export interface ToolCallPayload {
  readonly callId: string;
  readonly tool: string;
  readonly category: ToolCategory;
  /** The shell command line, when the tool runs one. */
  readonly command?: string;
  readonly input: unknown;
}

export type ResultStatus = 'ok' | 'error' | 'interrupted' | 'background' | 'unknown';

export interface ToolResultPayload {
  readonly callId: string;
  readonly tool?: string;
  readonly status: ResultStatus;
  readonly exitCode?: number;
  /** Head and tail of the output; the middle is elided for long results. */
  readonly output: string;
  readonly truncated: boolean;
}

export interface FileChange {
  readonly path: string;
  readonly op: 'create' | 'update' | 'delete' | 'move';
  readonly before?: string;
  readonly after?: string;
  readonly patch?: string;
  readonly movedTo?: string;
}

export interface EditPayload {
  readonly callId: string;
  readonly tool: string;
  readonly status: 'applied' | 'failed' | 'unknown';
  readonly changes: readonly FileChange[];
}

export interface TestRunPayload {
  readonly callId: string;
  readonly command: string;
  /** The segment of the command line that runs the tests. */
  readonly segment: string;
  readonly runner: string;
  readonly status: ResultStatus;
  readonly exitCode?: number;
  readonly startedAt: string;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly reasoning?: number;
}

export interface CostPayload {
  /** `message`: one model response. `session-total`: the agent's own running total. */
  readonly scope: 'message' | 'session-total';
  readonly model?: string;
  readonly tokens: TokenUsage;
  /** Only when the agent itself recorded a dollar figure. nocap does not guess prices. */
  readonly usd?: number;
}

interface PayloadByKind {
  prompt: PromptPayload;
  claim: ClaimPayload;
  tool_call: ToolCallPayload;
  tool_result: ToolResultPayload;
  edit: EditPayload;
  test_run: TestRunPayload;
  cost: CostPayload;
}

export type NocapEvent = {
  [K in EventKind]: {
    readonly ts: string;
    readonly agent: AgentId;
    readonly sessionId: string;
    readonly kind: K;
    readonly payload: PayloadByKind[K];
    /** 1-based line in the archived session file that produced the event. */
    readonly line: number;
    /** Subagent activity recorded inside the parent session. */
    readonly sidechain?: true;
  };
}[EventKind];

export type EventOf<K extends EventKind> = Extract<NocapEvent, { kind: K }>;

export interface SessionInfo {
  readonly agent: AgentId;
  readonly id: string;
  readonly cwd?: string;
  readonly cliVersion?: string;
  readonly model?: string;
  readonly gitBranch?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
}
