import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import type { Environment } from '../../src/core/paths.js';
import { readFixture } from './fixtures.js';

const j = (...parts: string[]): string => parts.join('');

/** Credentials that must never reach the archive or the index. Built at runtime. */
export const PLANTED_SECRETS = {
  githubToken: j('gh', 'p_', 'Z'.repeat(36)),
  anthropicKey: j('sk-', 'ant-', 'api03-', 'Y'.repeat(40)),
  envPassword: j('dotenv-', 'only-', 'value-', '42'),
  dbPassword: j('pg-', 'pass-', '9876'),
} as const;

export const CLAUDE_PROJECT = '.claude/projects/-home-dev-acme';
export const CLAUDE_SESSION = '11111111-2222-4333-8444-555555555555';
export const CODEX_DAY = '.codex/sessions/2026/10/30';
export const CODEX_LEGACY =
  'rollout-2026-10-30T14-00-00-0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.jsonl';
export const CODEX_PAGINATED =
  'rollout-2026-10-30T16-00-00-0199b2c3-d4e5-7f60-8b9c-1d2e3f4a5b6c.jsonl.zst';

/** A session that leaks a token, an API key, a .env file and a database URL. */
function leakySession(home: string): string {
  const s = '22222222-3333-4444-8555-666666666666';
  const base = {
    sessionId: s,
    cwd: join(home, 'acme'),
    version: '2.1.316',
    isSidechain: false,
    userType: 'external',
  };
  const lines = [
    {
      ...base,
      type: 'user',
      uuid: 'l1',
      timestamp: '2026-10-30T11:00:00.000Z',
      origin: { kind: 'human' },
      message: { role: 'user', content: `deploy with ${PLANTED_SECRETS.githubToken}` },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'l2',
      timestamp: '2026-10-30T11:00:01.000Z',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_env',
            name: 'Read',
            input: { file_path: join(home, 'acme/.env') },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      ...base,
      type: 'user',
      uuid: 'l3',
      timestamp: '2026-10-30T11:00:02.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_env',
            content: `     1→SESSION_SALT=${PLANTED_SECRETS.envPassword}\n`,
          },
        ],
      },
      toolUseResult: {
        type: 'text',
        file: {
          filePath: join(home, 'acme/.env'),
          content: `SESSION_SALT=${PLANTED_SECRETS.envPassword}\n`,
        },
      },
    },
    {
      ...base,
      type: 'assistant',
      uuid: 'l4',
      timestamp: '2026-10-30T11:00:03.000Z',
      message: {
        id: 'm2',
        model: 'claude-opus-5-5',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_db',
            name: 'Bash',
            input: {
              command: `ANTHROPIC_API_KEY=${PLANTED_SECRETS.anthropicKey} psql postgres://admin:${PLANTED_SECRETS.dbPassword}@db.example.com/prod -c 'select 1'`,
            },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    },
    {
      ...base,
      type: 'user',
      uuid: 'l5',
      timestamp: '2026-10-30T11:00:04.000Z',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_db',
            content: ' ?column?\n----------\n        1',
          },
        ],
      },
      toolUseResult: {
        stdout: ' ?column?\n----------\n        1',
        stderr: '',
        interrupted: false,
        isImage: false,
      },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function put(home: string, path: string, contents: string | Buffer): void {
  const file = join(home, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

export interface TestHome {
  readonly home: string;
  readonly environment: Environment;
  cleanup(): void;
}

/** A throwaway home directory holding the fixtures as real agent logs. */
export function createHome(options: { unknownTypes?: boolean } = {}): TestHome {
  const home = mkdtempSync(join(tmpdir(), 'nocap-home-'));
  put(
    home,
    `${CLAUDE_PROJECT}/${CLAUDE_SESSION}.jsonl`,
    readFixture('claude-code/2.1.316/basic.jsonl'),
  );
  put(home, `${CLAUDE_PROJECT}/22222222-3333-4444-8555-666666666666.jsonl`, leakySession(home));
  put(home, '.claude/settings.json', JSON.stringify({ cleanupPeriodDays: 30 }));
  put(home, `${CODEX_DAY}/${CODEX_LEGACY}`, readFixture('codex/0.166.0/legacy.jsonl'));
  put(
    home,
    `${CODEX_DAY}/${CODEX_PAGINATED}`,
    zstdCompressSync(Buffer.from(readFixture('codex/0.166.0/paginated.jsonl'))),
  );
  if (options.unknownTypes) {
    put(
      home,
      `${CLAUDE_PROJECT}/33333333-4444-4555-8666-777777777777.jsonl`,
      readFixture('claude-code/unknown-types.jsonl'),
    );
  }
  const environment: Environment = { home, env: { HOME: home, NOCAP_HOME: join(home, '.nocap') } };
  return {
    home,
    environment,
    cleanup: () => {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

export interface FileState {
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
  readonly sha256: string;
}

/** Every file under a directory, with enough detail to prove nothing changed. */
export function snapshotTree(root: string): Record<string, FileState> {
  const out: Record<string, FileState> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    const stat = statSync(path);
    if (!stat.isFile()) continue;
    out[relative(root, path)] = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      mode: stat.mode,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
  }
  return out;
}

/** Concatenated bytes of every file under a directory, for "is this string anywhere" checks. */
export function allBytes(root: string): string {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name)).toString('latin1'))
    .join('\n');
}
