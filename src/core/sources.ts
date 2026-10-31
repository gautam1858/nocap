// The only module that touches agent directories. Everything here is
// read-only: list, stat, read. Nothing under an agent root is ever opened for
// writing, renamed or deleted.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { Adapter } from '../adapters/types.js';
import type { AgentId } from './event.js';
import type { Environment } from './paths.js';

export interface SourceFile {
  readonly agent: AgentId;
  readonly absolutePath: string;
  /** Stable path inside the nocap archive, e.g. `codex/sessions/2026/10/31/rollout-....jsonl`. */
  readonly archivePath: string;
  readonly size: number;
  readonly mtimeMs: number;
}

function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

export function discoverSources(adapter: Adapter, environment: Environment): SourceFile[] {
  const found: SourceFile[] = [];
  for (const root of adapter.roots(environment.env, environment.home)) {
    if (!existsSync(root) || !lstatSync(root).isDirectory()) continue;
    // Dirents from a recursive read are not followed through symlinks, and
    // symlinked files are skipped below, so a link cannot lead outside the root.
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const absolutePath = join(entry.parentPath, entry.name);
      const relativePath = toPosix(relative(root, absolutePath));
      if (!adapter.isSessionFile(relativePath)) continue;
      const stat = lstatSync(absolutePath);
      found.push({
        agent: adapter.id,
        absolutePath,
        archivePath: `${adapter.id}/${basename(root)}/${relativePath.replace(/\.zst$/, '')}`,
        size: stat.size,
        mtimeMs: Math.trunc(stat.mtimeMs),
      });
    }
  }
  return found.sort((a, b) => a.archivePath.localeCompare(b.archivePath));
}

export interface SourceContents {
  readonly text: string;
  /** Hash of the bytes on disk, before decompression. */
  readonly sha256: string;
}

export function readSource(file: Pick<SourceFile, 'absolutePath'>): SourceContents {
  const bytes = readFileSync(file.absolutePath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const text = (file.absolutePath.endsWith('.zst') ? zstdDecompressSync(bytes) : bytes).toString(
    'utf8',
  );
  return { text, sha256 };
}
