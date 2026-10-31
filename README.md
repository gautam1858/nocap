# nocap

Your agent says "all tests pass." nocap checks the receipts.

nocap is a local-only black box for coding agents. It reads the session logs that Claude Code and
Codex CLI already leave on disk, pulls out what the agent claimed ("tests pass", "done", "I didn't
touch X"), checks each claim against what the agent actually ran, and cites the evidence for every
verdict.

> **Status: pre-release.** The CLI surface exists; the commands land one phase at a time.

## Ground rules

- **Nothing leaves your machine.** No network calls, no telemetry, no update checks. CI fails if
  any shipped code path, or any runtime dependency, can open a connection.
- **Read-only on agent directories.** nocap never modifies, moves or deletes anything under
  `~/.claude` or `~/.codex`. The archive copies; it never touches the originals.
- **Secrets are redacted at ingest**, before anything is stored or rendered.
- **"No evidence" is not "lied."** Verdicts are BACKED, STALE, NARROWED, NO EVIDENCE or
  CONTRADICTED, and each one cites the events that produced it.

## Development

Requires Node 22.13 or later.

```sh
npm ci
npm run check            # lint, format, typecheck, tests
node dist/cli/index.js --help
```

## License

MIT
