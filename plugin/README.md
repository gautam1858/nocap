# nocap — Claude Code plugin

Audit your coding agent's claims, render a Probable Cause card, and block
destructive commands. Everything runs locally; nothing leaves your machine.

## Prerequisite

The plugin drives the `nocap` CLI, so install it on your PATH first:

```bash
npm i -g nocap
```

## Install the plugin

Add this repo as a marketplace, then install:

```
/plugin marketplace add gautam1858/nocap
/plugin install nocap@nocap
```

## What you get

- **`/nocap`** — audits the current session and renders the Probable Cause card
  (SVG + PNG + a ready-to-post one-liner).
- **`/nocap-guard`** — installs or checks the fail-closed guard.
- **The guard hook** — once the plugin is enabled, every tool call is checked
  for destructive commands, identical-call loops, subagent fan-out and
  dead-man conditions, and blocked with the evidence if it trips. It fails
  closed, and logs every trip as a near miss.

## Notes

- The guard hook runs `nocap guard run` on every tool call, so `nocap` must be
  on your PATH (see the prerequisite). If it isn't found, the hook cannot run
  and tool calls proceed unguarded — run `/nocap-guard` to set up the faster
  direct hook, or `npm i -g nocap`.
- Turn the guard off any time with `NOCAP_GUARD_OFF=1`, without uninstalling.
- nocap is read-only on your agent directories and makes no network calls. See
  the [main README](https://github.com/gautam1858/nocap) for how to verify that.
