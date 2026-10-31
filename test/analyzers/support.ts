import type { FileChange, NocapEvent } from '../../src/core/event.js';

// A tiny fluent builder for event timelines. Each call advances the clock by a
// second so order and "after" relationships are unambiguous.
export class Timeline {
  readonly events: NocapEvent[] = [];
  #seconds = 0;
  #line = 0;

  #next(): { ts: string; line: number } {
    this.#seconds += 1;
    this.#line += 1;
    const ts = `2026-10-30T09:${String(Math.floor(this.#seconds / 60)).padStart(2, '0')}:${String(this.#seconds % 60).padStart(2, '0')}.000Z`;
    return { ts, line: this.#line };
  }

  prompt(text: string, origin: 'human' | 'system' = 'human'): this {
    this.events.push({
      ...this.#next(),
      agent: 'claude-code',
      sessionId: 's',
      kind: 'prompt',
      payload: { text, origin },
    });
    return this;
  }

  say(text: string): this {
    this.events.push({
      ...this.#next(),
      agent: 'claude-code',
      sessionId: 's',
      kind: 'claim',
      payload: { text },
    });
    return this;
  }

  test(command: string, exitCode: number, opts: { segment?: string; runner?: string } = {}): this {
    const { ts, line } = this.#next();
    this.events.push({
      ts,
      line,
      agent: 'claude-code',
      sessionId: 's',
      kind: 'test_run',
      payload: {
        callId: `c${String(line)}`,
        command,
        segment: opts.segment ?? command,
        runner: opts.runner ?? 'npm',
        status: exitCode === 0 ? 'ok' : 'error',
        exitCode,
        startedAt: ts,
      },
    });
    return this;
  }

  /** A test run whose outcome is unknown (interrupted, background). */
  testUnknown(command: string): this {
    const { ts, line } = this.#next();
    this.events.push({
      ts,
      line,
      agent: 'claude-code',
      sessionId: 's',
      kind: 'test_run',
      payload: {
        callId: `c${String(line)}`,
        command,
        segment: command,
        runner: 'npm',
        status: 'interrupted',
        startedAt: ts,
      },
    });
    return this;
  }

  edit(path: string, changes: Partial<FileChange> = {}): this {
    const { ts, line } = this.#next();
    this.events.push({
      ts,
      line,
      agent: 'claude-code',
      sessionId: 's',
      kind: 'edit',
      payload: {
        callId: `e${String(line)}`,
        tool: 'Edit',
        status: 'applied',
        changes: [{ path, op: 'update', ...changes }],
      },
    });
    return this;
  }

  done(): NocapEvent[] {
    return this.events;
  }
}
