# Fixtures

Every file here is synthetic. None of it comes from a real session.

Each fixture reproduces the record shapes one agent version writes to disk, so
an adapter can be tested against the format without anyone's data:

| Path                              | Shape taken from                                                        |
| --------------------------------- | ----------------------------------------------------------------------- |
| `claude-code/2.1.316/basic.jsonl` | Transcripts written by Claude Code 2.1.316 (keys and record types only) |
| `codex/0.166.0/legacy.jsonl`      | Codex CLI rust-v0.166.0 rollout types, legacy history mode              |
| `codex/0.166.0/paginated.jsonl`   | Codex CLI rust-v0.166.0 rollout types, paginated history mode           |
| `*/unknown-types.jsonl`           | Record types the adapters do not know, to exercise `nocap doctor`       |

The `*.events.json` files next to each fixture are the expected normalised
events. Regenerate them with `npx vitest run -u` after an intentional adapter
change, and review the diff.

Fixtures never contain anything that looks like a real credential. Tests that
need secrets build them at runtime.
