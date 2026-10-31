// Each entry upgrades the schema by one version; PRAGMA user_version records
// how many have run. Never edit a shipped migration; append a new one.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE sources (
    id               INTEGER PRIMARY KEY,
    agent            TEXT NOT NULL,
    archive_path     TEXT NOT NULL UNIQUE,
    original_path    TEXT,
    original_size    INTEGER,
    original_mtime   INTEGER,
    original_sha256  TEXT,
    archive_size     INTEGER,
    archive_mtime    INTEGER,
    parser_version   INTEGER NOT NULL,
    redaction_version INTEGER NOT NULL,
    archived_at      TEXT,
    indexed_at       TEXT NOT NULL,
    lines            INTEGER NOT NULL,
    events           INTEGER NOT NULL,
    errors           INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    agent        TEXT NOT NULL,
    id           TEXT NOT NULL,
    cwd          TEXT,
    cli_version  TEXT,
    model        TEXT,
    git_branch   TEXT,
    started_at   TEXT,
    ended_at     TEXT,
    PRIMARY KEY (agent, id)
  );

  CREATE TABLE events (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    line        INTEGER NOT NULL,
    agent       TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    ts          TEXT NOT NULL,
    kind        TEXT NOT NULL,
    sidechain   INTEGER NOT NULL DEFAULT 0,
    payload     TEXT NOT NULL
  );
  CREATE INDEX events_by_session ON events (agent, session_id, ts, seq);
  CREATE INDEX events_by_kind ON events (kind, ts);
  CREATE INDEX events_by_source ON events (source_id);

  -- Contentless: the text lives in events.payload already.
  CREATE VIRTUAL TABLE events_fts USING fts5 (text, content = '', contentless_delete = 1);

  CREATE TABLE unknown_types (
    source_id   INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,
    count       INTEGER NOT NULL,
    first_line  INTEGER NOT NULL,
    PRIMARY KEY (source_id, type)
  );

  CREATE TABLE redactions (
    source_id  INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    count      INTEGER NOT NULL,
    PRIMARY KEY (source_id, kind)
  );
  `,
];
