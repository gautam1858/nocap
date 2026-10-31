# nocap

Your agent says "all tests pass." nocap checks the receipts.

nocap is a local-only black box for coding agents. It reads the session logs that Claude Code and
Codex CLI already leave on disk, pulls out what the agent claimed ("tests pass", "done", "I didn't
touch X"), checks each claim against what the agent actually ran, and cites the evidence for every
verdict.

> **Status: pre-release.** `archive` and `doctor` work today; the rest land one phase at a time.

## What works now

```sh
nocap archive   # copy every session log into ~/.nocap, secrets redacted, and index it
nocap doctor    # agent versions, retention, adapter coverage, unknown record types
```

Claude Code deletes transcripts after 30 days by default. `nocap archive` keeps a
redacted copy of each one under `~/.nocap/archive` (or `$NOCAP_HOME`) and indexes it
into a local SQLite database with full-text search. Run it again and only new or
changed sessions are read. The index can always be rebuilt from the archive alone.

Supported so far: Claude Code (transcripts from 2.1.316) and Codex CLI (rollouts from
0.166.0, plain and zstd-compressed). `nocap doctor` tells you when it sees a record
type it does not understand, so format drift shows up as a report rather than as
silently missing data.

## Ground rules

- **Nothing leaves your machine.** No network calls, no telemetry, no update checks. CI fails if
  any shipped code path, or any runtime dependency, can open a connection.
- **Read-only on agent directories.** nocap never modifies, moves or deletes anything under
  `~/.claude` or `~/.codex`. The archive copies; it never touches the originals.
- **Secrets are redacted at ingest**, before anything is stored or rendered: API keys and
  tokens in known formats, private keys, JWTs, passwords in URLs, secret-named
  assignments, and the whole contents of `.env`-style files an agent read. Your home
  directory is written as `~`. The archive and index never hold the original text.
- **"No evidence" is not "lied."** Verdicts are BACKED, STALE, NARROWED, NO EVIDENCE or
  CONTRADICTED, and each one cites the events that produced it.

## Development

Requires Node 22.15 or later.

```sh
npm ci
npm run check            # lint, format, typecheck, tests
node dist/cli/index.js --help
```

## License

MIT
