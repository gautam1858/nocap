# Contributing to nocap

Thanks for helping. nocap has a few hard rules that keep it trustworthy; please read them before
opening a PR.

## Ground rules

- **100% local.** No code path may open a network connection — no telemetry, no update checks, no
  "optional" analytics. CI fails the build if any shipped file or runtime dependency can reach a
  socket, DNS, HTTP or `fetch`. See `test/no-network/`.
- **Read-only on agent directories.** Nothing under `~/.claude`, `~/.codex` or any agent's
  directory may be written, moved or deleted. The archive copies; it never touches originals.
- **Redact before you store.** Any new data that gets written must pass through the redactor first.
- **The guard fails closed.** Any change to `src/guard/` must keep the rule: unparseable or
  unrecognised input blocks (exit 2), never allows.
- **No real session data, ever.** All fixtures are synthetic or hand-sanitised. Never commit a
  real transcript, and never commit anything that looks like a real credential (tests build
  secret-shaped strings at runtime).

## Getting set up

```bash
npm ci
npm run check      # lint, format, typecheck, tests — must pass before a PR
```

Node 22.15+ is required. There are no runtime dependencies; please keep it that way. If you think a
runtime dependency is genuinely needed, open an issue first — it has to be auditable, offline, and
listed in `REVIEWED_RUNTIME_DEPENDENCIES` in `test/no-network/shipped-code.test.ts`.

## Adding an adapter for a new agent

An adapter turns one agent's on-disk logs into nocap's normalised `Event` stream. Everything
downstream — polygraph, testwash, card, guard — works off those events, so a good adapter is all
it takes to support a new agent.

1. **Inspect the real format first.** Do not trust docs or memory; they drift. Look at actual files
   on disk (`ls ~/.<agent>/…`, `head` a real log) and note the record shapes. Then write a
   **synthetic** fixture under `fixtures/<agent>/<version>/` that reproduces those shapes with no
   real data.

2. **Implement `Adapter`** (`src/adapters/types.ts`) in `src/adapters/<agent>.ts`:
   - `roots(env, home)` — the directories to scan (honour any `*_CONFIG_DIR`/`*_HOME` env var).
   - `isSessionFile(relativePath)` — which files are session logs.
   - `parse(lines, context)` — emit `NocapEvent`s. Map the agent's records onto the shared kinds:
     `prompt` (mark human vs. system), `claim` (assistant prose), `tool_call`, `tool_result`
     (with an exit code where you can get one), `edit` (with before/after or a patch),
     `test_run` (reuse `detectTestCommand`), and `cost`.
   - Report record types you don't recognise with `noteUnknown(...)` instead of dropping them —
     that's what makes `nocap doctor` able to flag format drift.

3. **Register it** in `src/adapters/index.ts` and add the agent to `AgentId` in
   `src/core/event.ts`. If adapter output changes, bump `PARSER_VERSION`.

4. **Add golden tests.** Snapshot the parsed events (`toMatchFileSnapshot`) and assert the
   verdict-relevant fields (prompt origin, exit codes, scope, edits). See
   `test/adapters/claude-code.test.ts` and `test/adapters/codex.test.ts` for the pattern.

5. **Run it on your own machine** and check `nocap doctor` is clean (no unparseable lines, no
   unrecognised record types). Share the doctor output in your PR — type names and counts only,
   never content.

## Commits and reviews

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`), small and
  focused, one logical change each.
- Comments explain _why_, sparingly. No narration of what the code plainly does.
- New behaviour comes with tests. Accuracy over drama: a false accusation is worse than a miss, so
  new polygraph or testwash rules should be biased toward NO EVIDENCE when unsure, and come with
  both positive and negative test cases.
