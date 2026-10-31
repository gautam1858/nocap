---
description: Install or check nocap's destructive-command guard
allowed-tools: Bash(nocap:*), Bash(npx @anv1858/nocap:*)
---

# /nocap-guard

Set up nocap's fail-closed guard — the seatbelt that blocks destructive
commands, runaway loops, subagent fan-out and dead-man conditions before they
run, and logs every trip as a near miss.

Run `nocap guard install` to wire a fast, direct hook into the agent settings
(it keeps a backup and leaves existing hooks alone), then `nocap guard status`
to confirm. Report what it installed and where.

To turn it off later: `nocap guard uninstall`, or set `NOCAP_GUARD_OFF=1`.
