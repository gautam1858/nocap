import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { adapters, PARSER_VERSION } from '../adapters/index.js';
import type { AgentId } from '../core/event.js';
import { archiveDir, databasePath, type Environment } from '../core/paths.js';
import { discoverSources, readSource } from '../core/sources.js';
import { REDACTION_VERSION } from '../redact/redactor.js';
import { Store } from '../store/store.js';
import { processText, type ProcessedFile } from './process.js';

function writeArchive(file: string, lines: readonly string[]): { size: number; mtime: number } {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${String(process.pid)}`;
  writeFileSync(temporary, lines.length > 0 ? `${lines.join('\n')}\n` : '', { mode: 0o600 });
  renameSync(temporary, file);
  const stat = statSync(file);
  return { size: stat.size, mtime: Math.trunc(stat.mtimeMs) };
}

function displayPath(path: string, home: string): string {
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

export interface AgentArchiveReport {
  readonly agent: AgentId;
  readonly name: string;
  readonly roots: readonly string[];
  scanned: number;
  archived: number;
  unchanged: number;
  reindexed: number;
  events: number;
  errors: number;
  readonly unknown: Map<string, number>;
  readonly redactions: Map<string, number>;
}

export interface ArchiveOptions {
  readonly environment: Environment;
  readonly agents?: readonly AgentId[];
  /** Read and redact everything, write nothing. */
  readonly dryRun?: boolean;
  readonly now?: () => Date;
}

function assertOutsideAgentRoots(environment: Environment, target: string): void {
  const resolvedTarget = resolve(target);
  for (const adapter of adapters) {
    for (const root of adapter.roots(environment.env, environment.home)) {
      const base = resolve(root, '..');
      if (resolvedTarget === base || resolvedTarget.startsWith(base + sep)) {
        throw new Error(
          `refusing to write the nocap archive inside ${adapter.name}'s directory (${base}). ` +
            'Set NOCAP_HOME to a location outside it.',
        );
      }
    }
  }
}

export function runArchive(options: ArchiveOptions): AgentArchiveReport[] {
  const { environment } = options;
  const now = (options.now ?? (() => new Date()))().toISOString();
  const archiveRoot = archiveDir(environment);
  assertOutsideAgentRoots(environment, archiveRoot);
  const store = options.dryRun ? Store.memory() : Store.open(databasePath(environment));
  const selected = adapters.filter((a) => !options.agents || options.agents.includes(a.id));
  const reports: AgentArchiveReport[] = [];

  try {
    for (const adapter of selected) {
      const report: AgentArchiveReport = {
        agent: adapter.id,
        name: adapter.name,
        roots: adapter.roots(environment.env, environment.home).filter((r) => existsSync(r)),
        scanned: 0,
        archived: 0,
        unchanged: 0,
        reindexed: 0,
        events: 0,
        errors: 0,
        unknown: new Map(),
        redactions: new Map(),
      };
      const tally = (processed: ProcessedFile): void => {
        report.events += processed.result.events.length;
        report.errors += processed.result.errors.length;
        for (const [type, seen] of processed.result.unknown) {
          report.unknown.set(type, (report.unknown.get(type) ?? 0) + seen.count);
        }
        for (const [kind, count] of processed.redactions) {
          report.redactions.set(kind, (report.redactions.get(kind) ?? 0) + count);
        }
      };

      const seen = new Set<string>();
      for (const source of discoverSources(adapter, environment)) {
        report.scanned++;
        seen.add(source.archivePath);
        const row = store.source(source.archivePath);
        const archiveFile = join(archiveRoot, source.archivePath);
        const current =
          row?.parser_version === PARSER_VERSION &&
          row.redaction_version === REDACTION_VERSION &&
          existsSync(archiveFile);
        if (current && row.original_size === source.size && row.original_mtime === source.mtimeMs) {
          report.unchanged++;
          continue;
        }
        const contents = readSource(source);
        if (current && row.original_sha256 === contents.sha256) {
          if (!options.dryRun) store.touchOriginal(source.archivePath, source.size, source.mtimeMs);
          report.unchanged++;
          continue;
        }
        const processed = processText(adapter, contents.text, source.archivePath, environment.home);
        const archive = options.dryRun
          ? { size: 0, mtime: 0 }
          : writeArchive(archiveFile, processed.lines);
        store.replaceSource(
          {
            agent: adapter.id,
            archivePath: source.archivePath,
            original: {
              path: displayPath(source.absolutePath, environment.home),
              size: source.size,
              mtime: source.mtimeMs,
              sha256: contents.sha256,
            },
            archive,
            parserVersion: PARSER_VERSION,
            redactionVersion: REDACTION_VERSION,
            redactions: processed.redactions,
            redactionsComplete: true,
            archivedAt: now,
          },
          processed.result,
          now,
        );
        report.archived++;
        tally(processed);
      }

      // Archived copies whose originals the agent has since deleted, or whose
      // index is missing or stale, are re-indexed from the archive itself.
      const agentArchive = join(archiveRoot, adapter.id);
      if (existsSync(agentArchive)) {
        for (const entry of readdirSync(agentArchive, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
          const file = join(entry.parentPath, entry.name);
          const archivePath = `${adapter.id}/${relative(agentArchive, file).split(sep).join('/')}`;
          if (seen.has(archivePath)) continue;
          const row = store.source(archivePath);
          const stat = statSync(file);
          const mtime = Math.trunc(stat.mtimeMs);
          if (
            row?.parser_version === PARSER_VERSION &&
            row.redaction_version === REDACTION_VERSION &&
            row.archive_size === stat.size &&
            row.archive_mtime === mtime
          ) {
            continue;
          }
          const processed = processText(
            adapter,
            readFileSync(file, 'utf8'),
            archivePath,
            environment.home,
          );
          const archive =
            processed.changed && !options.dryRun
              ? writeArchive(file, processed.lines)
              : { size: stat.size, mtime };
          store.replaceSource(
            {
              agent: adapter.id,
              archivePath,
              archive,
              parserVersion: PARSER_VERSION,
              redactionVersion: REDACTION_VERSION,
              redactions: processed.redactions,
              redactionsComplete: false,
            },
            processed.result,
            now,
          );
          report.reindexed++;
          tally(processed);
        }
      }
      reports.push(report);
    }
  } finally {
    store.close();
  }
  return reports;
}
