import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, sep } from 'node:path';
import { adapters, PARSER_VERSION } from '../adapters/index.js';
import type { Adapter } from '../adapters/types.js';
import { processText } from '../archive/process.js';
import type { AgentId } from '../core/event.js';
import { databasePath, nocapHome, type Environment } from '../core/paths.js';
import { discoverSources, readSource } from '../core/sources.js';
import { REDACTION_VERSION } from '../redact/redactor.js';
import { Store, type SourceRow } from '../store/store.js';

const DAY = 24 * 60 * 60 * 1000;

/** Claude Code's documented default for cleanupPeriodDays. */
const CLAUDE_DEFAULT_RETENTION_DAYS = 30;

const BINARIES: Record<AgentId, { command: string; packageName: string }> = {
  'claude-code': { command: 'claude', packageName: '@anthropic-ai/claude-code' },
  codex: { command: 'codex', packageName: '@openai/codex' },
};

export interface Installed {
  readonly path: string;
  readonly version?: string;
}

export interface UnknownTypeReport {
  readonly count: number;
  readonly example: string;
}

export interface AgentDoctorReport {
  readonly agent: AgentId;
  readonly name: string;
  readonly roots: readonly { path: string; exists: boolean }[];
  readonly installed?: Installed;
  readonly files: number;
  readonly bytes: number;
  readonly archived: number;
  readonly notArchived: number;
  /** Unarchived files the agent is due to delete within a week. */
  readonly expiringSoon: number;
  readonly retentionDays?: { value: number; source: 'settings' | 'default' };
  readonly versions: ReadonlyMap<string, number>;
  readonly lines: number;
  readonly events: number;
  readonly parseErrors: number;
  readonly unknown: ReadonlyMap<string, UnknownTypeReport>;
  readonly redactions: ReadonlyMap<string, number>;
}

export interface DoctorReport {
  readonly nocapHome: string;
  readonly node: string;
  readonly platform: string;
  readonly index?: { sources: number; events: number; sessions: number; stale: number };
  readonly agents: readonly AgentDoctorReport[];
  readonly problems: readonly string[];
}

function display(path: string, home: string): string {
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

/** Finds an agent's executable on PATH and its version, without running it. */
export function findInstalled(agent: AgentId, environment: Environment): Installed | undefined {
  const { command, packageName } = BINARIES[agent];
  for (const dir of (environment.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    if (!existsSync(candidate)) continue;
    let real = candidate;
    try {
      real = realpathSync(candidate);
    } catch {
      // A dangling link still tells us where it was installed.
    }
    for (let d = dirname(real); dirname(d) !== d; d = dirname(d)) {
      const manifest = join(d, 'package.json');
      if (!existsSync(manifest)) continue;
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        if (pkg.name === packageName && typeof pkg.version === 'string') {
          return { path: display(candidate, environment.home), version: pkg.version };
        }
      } catch {
        // Not the manifest we are looking for.
      }
    }
    // Native installers keep each release in a versioned directory.
    const version = /[/\\](\d+\.\d+\.\d+(?:[-+][\w.]+)?)(?:[/\\]|$)/.exec(real)?.[1];
    return { path: display(candidate, environment.home), ...(version ? { version } : {}) };
  }
  return undefined;
}

function claudeRetention(environment: Environment): AgentDoctorReport['retentionDays'] {
  const settings = join(
    environment.env.CLAUDE_CONFIG_DIR ?? join(environment.home, '.claude'),
    'settings.json',
  );
  try {
    const parsed = JSON.parse(readFileSync(settings, 'utf8')) as { cleanupPeriodDays?: unknown };
    if (typeof parsed.cleanupPeriodDays === 'number') {
      return { value: parsed.cleanupPeriodDays, source: 'settings' };
    }
  } catch {
    // Missing or unreadable settings mean the default applies.
  }
  return { value: CLAUDE_DEFAULT_RETENTION_DAYS, source: 'default' };
}

function isCurrent(row: SourceRow | undefined, size: number, mtime: number): boolean {
  return (
    row?.original_size === size &&
    row.original_mtime === mtime &&
    row.parser_version === PARSER_VERSION &&
    row.redaction_version === REDACTION_VERSION
  );
}

function inspectAgent(
  adapter: Adapter,
  environment: Environment,
  store: Store | undefined,
  now: number,
): AgentDoctorReport {
  const roots = adapter.roots(environment.env, environment.home).map((path) => ({
    path: display(path, environment.home),
    exists: existsSync(path),
  }));
  const retention = adapter.id === 'claude-code' ? claudeRetention(environment) : undefined;
  const versions = new Map<string, number>();
  const unknown = new Map<string, UnknownTypeReport>();
  const redactions = new Map<string, number>();
  let bytes = 0;
  let archived = 0;
  let expiringSoon = 0;
  let lines = 0;
  let events = 0;
  let parseErrors = 0;

  const sources = discoverSources(adapter, environment);
  for (const source of sources) {
    bytes += source.size;
    if (isCurrent(store?.source(source.archivePath), source.size, source.mtimeMs)) archived++;
    else if (retention && now - source.mtimeMs > (retention.value - 7) * DAY) expiringSoon++;

    const processed = processText(
      adapter,
      readSource(source).text,
      source.archivePath,
      environment.home,
    );
    lines += processed.result.lines;
    events += processed.result.events.length;
    parseErrors += processed.result.errors.length;
    for (const session of processed.result.sessions) {
      if (session.cliVersion)
        versions.set(session.cliVersion, (versions.get(session.cliVersion) ?? 0) + 1);
    }
    for (const [type, seen] of processed.result.unknown) {
      const previous = unknown.get(type);
      unknown.set(type, {
        count: (previous?.count ?? 0) + seen.count,
        example: previous?.example ?? `${source.archivePath}:${String(seen.firstLine)}`,
      });
    }
    for (const [kind, count] of processed.redactions)
      redactions.set(kind, (redactions.get(kind) ?? 0) + count);
  }

  const installed = findInstalled(adapter.id, environment);
  return {
    agent: adapter.id,
    name: adapter.name,
    roots,
    ...(installed ? { installed } : {}),
    files: sources.length,
    bytes,
    archived,
    notArchived: sources.length - archived,
    expiringSoon,
    ...(retention ? { retentionDays: retention } : {}),
    versions,
    lines,
    events,
    parseErrors,
    unknown,
    redactions,
  };
}

export function runDoctor(environment: Environment, now = Date.now()): DoctorReport {
  const dbPath = databasePath(environment);
  const problems: string[] = [];
  // A missing index is not created here; doctor only reports.
  let store: Store | undefined;
  if (existsSync(dbPath)) {
    try {
      store = Store.open(dbPath);
    } catch (error) {
      problems.push(
        `The index at ${display(dbPath, environment.home)} could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  try {
    const agents = adapters.map((adapter) => inspectAgent(adapter, environment, store, now));
    for (const a of agents) {
      if (a.expiringSoon > 0) {
        problems.push(
          `${a.name}: ${String(a.expiringSoon)} unarchived session file(s) are due for deletion by ${a.name} within 7 days. Run 'nocap archive' now.`,
        );
      }
      if (a.notArchived > a.expiringSoon) {
        problems.push(
          `${a.name}: ${String(a.notArchived)} session file(s) are new or changed since the last archive. Run 'nocap archive'.`,
        );
      }
      if (a.parseErrors > 0) {
        problems.push(`${a.name}: ${String(a.parseErrors)} line(s) could not be parsed as JSON.`);
      }
      if (a.unknown.size > 0) {
        problems.push(
          `${a.name}: ${String(a.unknown.size)} record type(s) nocap does not recognise; their events are not audited. Please report them (type names and versions only).`,
        );
      }
    }
    let index: DoctorReport['index'];
    if (store) {
      const count = (sql: string): number => (store.db.prepare(sql).get() as { n: number }).n;
      index = {
        sources: count('SELECT count(*) AS n FROM sources'),
        events: count('SELECT count(*) AS n FROM events'),
        sessions: count('SELECT count(*) AS n FROM sessions'),
        stale: count(
          `SELECT count(*) AS n FROM sources WHERE parser_version != ${String(PARSER_VERSION)} OR redaction_version != ${String(REDACTION_VERSION)}`,
        ),
      };
    }
    return {
      nocapHome: display(nocapHome(environment), environment.home),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      ...(index ? { index } : {}),
      agents,
      problems,
    };
  } finally {
    store?.close();
  }
}
