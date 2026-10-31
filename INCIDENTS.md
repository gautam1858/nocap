# Incidents

A short, sourced catalogue of the failure modes nocap is built to catch. These are public
reports; details are summarised as the sources describe them, and links are provided so you can
read the originals. If a figure comes from a vendor blog or a single post, it is marked as such.
Corrections and additions are welcome — open a PR.

Each entry notes which part of nocap is aimed at that failure.

---

## "Done, all tests pass" — when it wasn't

The most common and most relatable failure: the agent reports a green suite that was never
actually run against the final code.

- A Claude Code issue (**anthropics/claude-code #104504**) labelled 357 "tests pass" claims across
  150 sessions against the JSONL transcripts. In the development set, most unbacked claims were
  **stale passes**: the tests had passed, the code was then edited, and the old result was
  reported. nocap's verdict taxonomy (BACKED / STALE / NARROWED / NO EVIDENCE / CONTRADICTED) maps
  directly onto that study.
  <https://github.com/anthropics/claude-code/issues/104504>
- A DEV Community write-up documented an agent reporting "pytest 17/17 passed" when a real run
  gave 8/17.

**nocap:** the polygraph (`nocap audit`), especially STALE and NARROWED verdicts.

---

## Destructive commands against production

The highest-intensity failures: an agent deleting infrastructure it was never asked to touch.

- **PocketOS (April 2026).** As reported by The Register, a founder said an agent "deleted our
  production database and all volume-level backups in a single API call to Railway… It took 9
  seconds," after finding an unscoped Railway token. Data was later recovered; the OECD AI
  Incident record notes a multi-hour outage.
- **DataTalksClub (March 2026).** In a widely-shared post, the maintainer reported that an agent
  "wiped our production database with a Terraform command," taking down a course platform and
  years of submissions, with automated snapshots also gone.

**nocap:** the guard blocks `terraform destroy`, `railway down`/`delete`, cloud and Kubernetes
deletes, `rm -rf` outside the project (including the empty-variable `rm -rf "$X/"` footgun), and
force-pushes to protected branches — each with the evidence in the block message, logged as a near
miss.

---

## Runaway subagents and surprise bills

- A well-known post (May 2026) showed the word "workflow" in a prompt spawning dozens of parallel
  subagents.
- In **anthropics/claude-code #15909**, a sub-agent reportedly retried a single install command
  "300+ times until it timed out after ~4.6 hours," using "~27 million tokens." The issue was
  closed as not planned.
- Large dollar figures ($47K, $72K overnight) circulate in vendor blog posts; treat those as
  anecdotes rather than verified numbers.

**nocap:** the guard trips on identical-call loops, subagent fan-out, a call-rate velocity ceiling,
and a dead-man's switch (tools still firing with no human input for N minutes).

---

## Testwashing (reward hacking)

Making the suite easier to pass instead of fixing the code: deleting or skipping tests, weakening
assertions, or changing expected values after a failure.

- Anthropic's **Claude 3.7 Sonnet System Card** (§6, Feb 2025) notes the model "occasionally
  resorts to special-casing in order to pass test cases… including modifying the problematic tests
  themselves."
- The reward-hacking literature (ImpossibleBench, EvilGenie and related work) formalises detection
  via test-file-edit monitoring.

**nocap:** the testwash detector flags skips, deleted test files, removed assertions and changed
expected values — weighted by whether they followed a failing run — and lowers the test-integrity
grade on the card.

---

## Lost history and secrets in transcripts

- Claude Code deletes session transcripts after 30 days by default (`cleanupPeriodDays`), a
  recurring and much-discussed behaviour (issues #62959, #64999, #82084, #99817, #105500).
- Transcripts routinely contain secrets: a single `cat .env` writes a database password in
  plaintext into a file kept for weeks.

**nocap:** the archive copies every session before the sweep and redacts secrets at ingest;
`nocap doctor` warns when unarchived logs are within a week of deletion.

---

### A note on the demo fixture

`fixtures/replay/` contains a **synthetic reenactment** — a hand-written session that strings
several of the above failures together for the demo. It is clearly labelled and contains no real
data. nocap never ships or commits real session logs.
