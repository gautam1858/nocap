import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ParseResult } from '../adapters/types.js';
import type { AgentId, NocapEvent, SessionInfo } from '../core/event.js';
import { MIGRATIONS } from './schema.js';

export interface SourceRow {
  readonly id: number;
  readonly agent: AgentId;
  readonly archive_path: string;
  readonly original_path: string | null;
  readonly original_size: number | null;
  readonly original_mtime: number | null;
  readonly original_sha256: string | null;
  readonly archive_size: number | null;
  readonly archive_mtime: number | null;
  readonly parser_version: number;
  readonly redaction_version: number;
}

export interface SourceUpdate {
  readonly agent: AgentId;
  readonly archivePath: string;
  readonly original?: { path: string; size: number; mtime: number; sha256: string };
  readonly archive: { size: number; mtime: number };
  readonly parserVersion: number;
  readonly redactionVersion: number;
  readonly redactions: ReadonlyMap<string, number>;
  /**
   * True when this pass redacted the original from scratch, so its counts are
   * complete. False when it re-scanned an already redacted archive copy, so its
   * counts are added to earlier ones.
   */
  readonly redactionsComplete: boolean;
  readonly archivedAt?: string;
}

/** Text worth searching for, per event. Payloads are already redacted. */
export function searchText(event: NocapEvent): string {
  switch (event.kind) {
    case 'prompt':
    case 'claim':
      return event.payload.text;
    case 'tool_call':
      return [event.payload.tool, event.payload.command ?? ''].join(' ').trim();
    case 'tool_result':
      return event.payload.output;
    case 'edit':
      return event.payload.changes.map((c) => c.path).join(' ');
    case 'test_run':
      return event.payload.command;
    case 'cost':
      return '';
  }
}

export class Store {
  readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(path: string): Store {
    const fresh = !existsSync(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    if (fresh) chmodSync(path, 0o600);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const store = new Store(db);
    store.migrate();
    return store;
  }

  static memory(): Store {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    const store = new Store(db);
    store.migrate();
    return store;
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    const current = row.user_version;
    if (current > MIGRATIONS.length) {
      throw new Error(
        `the nocap database was written by a newer version (schema ${String(current)}); upgrade nocap`,
      );
    }
    for (let version = current; version < MIGRATIONS.length; version++) {
      this.transaction(() => {
        this.db.exec(MIGRATIONS[version] ?? '');
        this.db.exec(`PRAGMA user_version = ${String(version + 1)}`);
      });
    }
  }

  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  source(archivePath: string): SourceRow | undefined {
    return this.db.prepare('SELECT * FROM sources WHERE archive_path = ?').get(archivePath) as
      SourceRow | undefined;
  }

  sources(): SourceRow[] {
    return this.db
      .prepare('SELECT * FROM sources ORDER BY archive_path')
      .all() as unknown as SourceRow[];
  }

  /** Records new original metadata without re-indexing, e.g. after a touch with no content change. */
  touchOriginal(archivePath: string, size: number, mtime: number): void {
    this.db
      .prepare('UPDATE sources SET original_size = ?, original_mtime = ? WHERE archive_path = ?')
      .run(size, mtime, archivePath);
  }

  /** Replaces everything indexed from one archived file, atomically. */
  replaceSource(update: SourceUpdate, result: ParseResult, now: string): void {
    this.transaction(() => {
      const existing = this.source(update.archivePath);
      const previousRedactions = new Map<string, number>();
      if (existing) {
        for (const row of this.db
          .prepare('SELECT kind, count FROM redactions WHERE source_id = ?')
          .all(existing.id) as { kind: string; count: number }[]) {
          previousRedactions.set(row.kind, row.count);
        }
        const ids = this.db
          .prepare('SELECT id FROM events WHERE source_id = ?')
          .all(existing.id) as {
          id: number;
        }[];
        const deleteFts = this.db.prepare('DELETE FROM events_fts WHERE rowid = ?');
        for (const { id } of ids) deleteFts.run(id);
        this.db.prepare('DELETE FROM sources WHERE id = ?').run(existing.id);
      }

      const original = update.original;
      const inserted = this.db
        .prepare(
          `INSERT INTO sources (agent, archive_path, original_path, original_size, original_mtime,
             original_sha256, archive_size, archive_mtime, parser_version, redaction_version,
             archived_at, indexed_at, lines, events, errors)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          update.agent,
          update.archivePath,
          original?.path ?? existing?.original_path ?? null,
          original?.size ?? existing?.original_size ?? null,
          original?.mtime ?? existing?.original_mtime ?? null,
          original?.sha256 ?? existing?.original_sha256 ?? null,
          update.archive.size,
          update.archive.mtime,
          update.parserVersion,
          update.redactionVersion,
          update.archivedAt ?? null,
          now,
          result.lines,
          result.events.length,
          result.errors.length,
        );
      const sourceId = Number(inserted.lastInsertRowid);

      const insertEvent = this.db.prepare(
        `INSERT INTO events (source_id, seq, line, agent, session_id, ts, kind, sidechain, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = this.db.prepare('INSERT INTO events_fts (rowid, text) VALUES (?, ?)');
      result.events.forEach((event, seq) => {
        const row = insertEvent.run(
          sourceId,
          seq,
          event.line,
          event.agent,
          event.sessionId,
          event.ts,
          event.kind,
          event.sidechain ? 1 : 0,
          JSON.stringify(event.payload),
        );
        const text = searchText(event);
        if (text) insertFts.run(row.lastInsertRowid, text);
      });

      const upsertSession = this.db.prepare(
        `INSERT INTO sessions (agent, id, cwd, cli_version, model, git_branch, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent, id) DO UPDATE SET
           cwd = coalesce(sessions.cwd, excluded.cwd),
           cli_version = coalesce(excluded.cli_version, sessions.cli_version),
           model = coalesce(excluded.model, sessions.model),
           git_branch = coalesce(excluded.git_branch, sessions.git_branch),
           started_at = min(coalesce(sessions.started_at, excluded.started_at), coalesce(excluded.started_at, sessions.started_at)),
           ended_at = max(coalesce(sessions.ended_at, excluded.ended_at), coalesce(excluded.ended_at, sessions.ended_at))`,
      );
      for (const s of result.sessions) {
        upsertSession.run(
          s.agent,
          s.id,
          s.cwd ?? null,
          s.cliVersion ?? null,
          s.model ?? null,
          s.gitBranch ?? null,
          s.startedAt ?? null,
          s.endedAt ?? null,
        );
      }

      const insertUnknown = this.db.prepare(
        'INSERT INTO unknown_types (source_id, type, count, first_line) VALUES (?, ?, ?, ?)',
      );
      for (const [type, seen] of result.unknown)
        insertUnknown.run(sourceId, type, seen.count, seen.firstLine);

      const insertRedaction = this.db.prepare(
        'INSERT INTO redactions (source_id, kind, count) VALUES (?, ?, ?)',
      );
      const totals = update.redactionsComplete
        ? new Map<string, number>()
        : new Map(previousRedactions);
      for (const [kind, count] of update.redactions)
        totals.set(kind, (totals.get(kind) ?? 0) + count);
      for (const [kind, count] of totals) insertRedaction.run(sourceId, kind, count);
    });
  }

  /** Sessions in the index, most recently active first. */
  sessions(): SessionRow[] {
    return this.db
      .prepare(
        'SELECT agent, id, cwd, cli_version, model, git_branch, started_at, ended_at FROM sessions ORDER BY coalesce(ended_at, started_at) DESC, id',
      )
      .all() as unknown as SessionRow[];
  }

  session(agent: AgentId, id: string): SessionRow | undefined {
    return this.db
      .prepare(
        'SELECT agent, id, cwd, cli_version, model, git_branch, started_at, ended_at FROM sessions WHERE agent = ? AND id = ?',
      )
      .get(agent, id) as SessionRow | undefined;
  }

  /** Rebuilds the normalised events for a session, in file order, across every source that holds it. */
  eventsForSession(agent: AgentId, sessionId: string): NocapEvent[] {
    const rows = this.db
      .prepare(
        'SELECT line, ts, kind, sidechain, payload FROM events WHERE agent = ? AND session_id = ? ORDER BY ts, source_id, seq',
      )
      .all(agent, sessionId) as unknown[] as EventRow[];
    return rows.map((row) => {
      const base = {
        ts: row.ts,
        agent,
        sessionId,
        line: row.line,
        payload: JSON.parse(row.payload) as never,
        ...(row.sidechain ? { sidechain: true as const } : {}),
      };
      return { ...base, kind: row.kind };
    });
  }

  close(): void {
    this.db.close();
  }
}

export interface SessionRow {
  readonly agent: AgentId;
  readonly id: string;
  readonly cwd: string | null;
  readonly cli_version: string | null;
  readonly model: string | null;
  readonly git_branch: string | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
}

interface EventRow {
  readonly line: number;
  readonly ts: string;
  readonly kind: NocapEvent['kind'];
  readonly sidechain: number;
  readonly payload: string;
}

export function sessionInfoFromRow(row: SessionRow): SessionInfo {
  return {
    agent: row.agent,
    id: row.id,
    ...(row.cwd !== null ? { cwd: row.cwd } : {}),
    ...(row.cli_version !== null ? { cliVersion: row.cli_version } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.git_branch !== null ? { gitBranch: row.git_branch } : {}),
    ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
    ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
  };
}
