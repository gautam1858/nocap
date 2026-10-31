---
description: Audit this session's claims and render a Probable Cause card
argument-hint: '[session-id]'
allowed-tools: Bash(nocap:*), Bash(npx @anv1858/nocap:*)
---

# /nocap

Audit the current coding session with nocap and show me the verdict.

Do this, then report back — do not ask for confirmation first:

1. Run `nocap archive`. This indexes the latest sessions locally, with secrets
   redacted. It reads the agent's logs only and never touches the network.
2. Run `nocap card --share $1`. With no `$1` it audits the most recent session
   (this one). This writes a Probable Cause card (SVG + PNG) and a ready-to-post
   one-liner, and prints the `PROBABLE CAUSE:` line.
3. Summarise for me: the claim verdicts (backed / narrowed / stale /
   contradicted), the test-integrity grade, any near misses, and the one-line
   probable cause. Give me the path to the PNG so I can share it.

If the `nocap` command is not found, tell me to install it with
`npm i -g @anv1858/nocap`, or to use `npx @anv1858/nocap` in place of `nocap` above.
