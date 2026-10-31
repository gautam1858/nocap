import { describe, expect, it } from 'vitest';
import { LineRedactor } from '../../src/redact/lines.js';
import { Redactor } from '../../src/redact/redactor.js';

const j = (...parts: string[]): string => parts.join('');
const ENV_FILE = j('DB_PASSWORD=', 'plain-but-secret\n', 'REGION=eu-west-1\n');

function redactAll(lines: readonly object[]): string[] {
  const redactor = new LineRedactor(new Redactor({ home: '/home/dev' }));
  return lines.map((line) => redactor.line(JSON.stringify(line)).text);
}

describe('LineRedactor', () => {
  it('scrubs the result of a Read of .env, in both places Claude Code records it', () => {
    const [, result] = redactAll([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Read',
              input: { file_path: '/home/dev/app/.env' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: ENV_FILE }] },
        toolUseResult: {
          type: 'text',
          file: { filePath: '/home/dev/app/.env', content: ENV_FILE },
        },
      },
    ]);
    expect(result).not.toContain('plain-but-secret');
    expect(result).not.toContain('eu-west-1');
    expect(result).toContain('REGION=[REDACTED:secrets-file]');
  });

  it('scrubs the output of cat .env run through Bash', () => {
    const [, result] = redactAll([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'cat .env' } },
          ],
        },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: ENV_FILE }] },
        toolUseResult: { stdout: ENV_FILE },
      },
    ]);
    expect(result).not.toContain('plain-but-secret');
  });

  it('scrubs the output of a Codex exec_command that cats .env', () => {
    const [, result] = redactAll([
      {
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'cat .env' }),
          call_id: 'call_1',
        },
      },
      {
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'call_1',
          output: `Process exited with code 0\nOutput:\n${ENV_FILE}`,
        },
      },
    ]);
    expect(result).not.toContain('plain-but-secret');
  });

  it('does not treat output that merely mentions .env as a secrets file', () => {
    const [, result] = redactAll([
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_3',
              name: 'Bash',
              input: { command: 'grep -n env .gitignore' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_3',
              content: '69:.env\nno-cap: version = 0.1.0',
            },
          ],
        },
      },
    ]);
    expect(result).toContain('no-cap: version = 0.1.0');
  });

  it('leaves unchanged lines byte for byte', () => {
    const raw = '{"type":"user",  "message":{"role":"user","content":"hello"}}';
    const redactor = new LineRedactor(new Redactor({ home: '/home/dev' }));
    expect(redactor.line(raw).text).toBe(raw);
  });

  it('still redacts lines that are not JSON', () => {
    const redactor = new LineRedactor(new Redactor());
    const line = redactor.line(j('{"truncated": "', 'gh', 'p_', 'A'.repeat(36)));
    expect(line.value).toBeUndefined();
    expect(line.text).toContain('[REDACTED:github-token]');
  });
});
