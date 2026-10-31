import { appendFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runArchive } from '../../src/archive/archive.js';
import { archiveDir, databasePath } from '../../src/core/paths.js';
import { Store } from '../../src/store/store.js';
import {
  allBytes,
  CLAUDE_PROJECT,
  CLAUDE_SESSION,
  CODEX_DAY,
  CODEX_LEGACY,
  createHome,
  PLANTED_SECRETS,
  snapshotTree,
  type TestHome,
} from '../support/home.js';

let t: TestHome;
beforeEach(() => {
  t = createHome();
});
afterEach(() => {
  t.cleanup();
});

const totals = (reports: ReturnType<typeof runArchive>) => ({
  archived: reports.reduce((n, r) => n + r.archived, 0),
  unchanged: reports.reduce((n, r) => n + r.unchanged, 0),
  reindexed: reports.reduce((n, r) => n + r.reindexed, 0),
});

function withStore<T>(work: (store: Store) => T): T {
  const store = Store.open(databasePath(t.environment));
  try {
    return work(store);
  } finally {
    store.close();
  }
}

describe('nocap archive', () => {
  it('never modifies, moves or deletes anything in agent directories', () => {
    const claude = snapshotTree(join(t.home, '.claude'));
    const codex = snapshotTree(join(t.home, '.codex'));
    runArchive({ environment: t.environment });
    runArchive({ environment: t.environment });
    expect(snapshotTree(join(t.home, '.claude'))).toEqual(claude);
    expect(snapshotTree(join(t.home, '.codex'))).toEqual(codex);
  });

  it('archives every session file, including zstd-compressed rollouts', () => {
    const reports = runArchive({ environment: t.environment });
    expect(reports.map((r) => [r.agent, r.scanned, r.archived])).toEqual([
      ['claude-code', 2, 2],
      ['codex', 2, 2],
    ]);
    const archived = join(archiveDir(t.environment), 'codex/sessions/2026/10/30');
    expect(existsSync(join(archived, CODEX_LEGACY))).toBe(true);
    expect(
      existsSync(
        join(archived, 'rollout-2026-10-30T16-00-00-0199b2c3-d4e5-7f60-8b9c-1d2e3f4a5b6c.jsonl'),
      ),
    ).toBe(true);
  });

  it('keeps planted secrets out of everything it writes, the database included', () => {
    const reports = runArchive({ environment: t.environment });
    const written = allBytes(join(t.home, '.nocap'));
    for (const secret of Object.values(PLANTED_SECRETS)) expect(written).not.toContain(secret);
    expect(Object.fromEntries(reports[0]?.redactions ?? [])).toMatchObject({
      'github-token': 1,
      'anthropic-key': 1,
      'url-credentials': 1,
      'secrets-file': 2,
    });
  });

  it('keeps archived copies private to the user', () => {
    runArchive({ environment: t.environment });
    const file = join(
      archiveDir(t.environment),
      `claude-code/projects/-home-dev-acme/${CLAUDE_SESSION}.jsonl`,
    );
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(databasePath(t.environment)).mode & 0o777).toBe(0o600);
  });

  it('leaves lines without secrets byte-for-byte identical in the archive', () => {
    runArchive({ environment: t.environment });
    const original = readFileSync(join(t.home, CODEX_DAY, CODEX_LEGACY), 'utf8');
    const archived = readFileSync(
      join(archiveDir(t.environment), 'codex/sessions/2026/10/30', CODEX_LEGACY),
      'utf8',
    );
    expect(archived).toBe(original);
  });

  it('indexes events and makes them searchable', () => {
    runArchive({ environment: t.environment });
    withStore((store) => {
      const kinds = store.db
        .prepare('SELECT kind, count(*) AS n FROM events GROUP BY kind ORDER BY kind')
        .all();
      expect(kinds.length).toBe(7);
      const hits = store.db
        .prepare(
          "SELECT e.kind FROM events_fts f JOIN events e ON e.id = f.rowid WHERE events_fts MATCH 'discount' ORDER BY e.id",
        )
        .all() as { kind: string }[];
      expect(hits.map((h) => h.kind)).toContain('prompt');
      expect(store.db.prepare('SELECT count(*) AS n FROM sessions').get()).toEqual({ n: 4 });
    });
  });

  it('skips unchanged files on the next run', () => {
    runArchive({ environment: t.environment });
    const archived = snapshotTree(archiveDir(t.environment));
    expect(totals(runArchive({ environment: t.environment }))).toEqual({
      archived: 0,
      unchanged: 4,
      reindexed: 0,
    });
    expect(snapshotTree(archiveDir(t.environment))).toEqual(archived);
  });

  it('re-archives a session that grew', () => {
    runArchive({ environment: t.environment });
    appendFileSync(
      join(t.home, CLAUDE_PROJECT, `${CLAUDE_SESSION}.jsonl`),
      `${JSON.stringify({ type: 'mode', mode: 'normal', sessionId: CLAUDE_SESSION })}\n`,
    );
    expect(totals(runArchive({ environment: t.environment }))).toEqual({
      archived: 1,
      unchanged: 3,
      reindexed: 0,
    });
  });

  it('keeps sessions the agent has deleted, and rebuilds the index from the archive alone', () => {
    runArchive({ environment: t.environment });
    const before = withStore((s) => s.db.prepare('SELECT count(*) AS n FROM events').get());
    rmSync(join(t.home, '.claude'), { recursive: true });
    rmSync(join(t.home, '.codex'), { recursive: true });
    rmSync(databasePath(t.environment));

    expect(totals(runArchive({ environment: t.environment }))).toEqual({
      archived: 0,
      unchanged: 0,
      reindexed: 4,
    });
    expect(withStore((s) => s.db.prepare('SELECT count(*) AS n FROM events').get())).toEqual(
      before,
    );
    for (const secret of Object.values(PLANTED_SECRETS)) {
      expect(allBytes(join(t.home, '.nocap'))).not.toContain(secret);
    }
  });

  it('writes nothing on a dry run', () => {
    const reports = runArchive({ environment: t.environment, dryRun: true });
    expect(totals(reports).archived).toBe(4);
    expect(existsSync(join(t.home, '.nocap'))).toBe(false);
  });

  it('can be limited to one agent', () => {
    expect(
      runArchive({ environment: t.environment, agents: ['codex'] }).map((r) => r.agent),
    ).toEqual(['codex']);
  });

  it('refuses to put its archive inside an agent directory', () => {
    const environment = {
      ...t.environment,
      env: { ...t.environment.env, NOCAP_HOME: join(t.home, '.claude/nocap') },
    };
    expect(() => runArchive({ environment })).toThrow(
      /refusing to write the nocap archive inside Claude Code/,
    );
    expect(existsSync(join(t.home, '.claude/nocap'))).toBe(false);
  });
});
