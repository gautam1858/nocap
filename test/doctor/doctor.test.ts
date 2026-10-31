import { chmodSync, existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runArchive } from '../../src/archive/archive.js';
import { renderDoctor } from '../../src/cli/commands/doctor.js';
import { databasePath } from '../../src/core/paths.js';
import { findInstalled, runDoctor } from '../../src/doctor/doctor.js';
import { createHome, snapshotTree, type TestHome } from '../support/home.js';

let t: TestHome | undefined;
afterEach(() => {
  t?.cleanup();
  t = undefined;
});

describe('nocap doctor', () => {
  it('reports unarchived sessions as a problem until they are archived', () => {
    t = createHome();
    const before = runDoctor(t.environment);
    expect(before.problems).toEqual([
      "Claude Code: 2 session file(s) are new or changed since the last archive. Run 'nocap archive'.",
      "Codex CLI: 2 session file(s) are new or changed since the last archive. Run 'nocap archive'.",
    ]);
    runArchive({ environment: t.environment });
    const after = runDoctor(t.environment);
    expect(after.problems).toEqual([]);
    expect(renderDoctor(after)).toContain('No problems found.');
  });

  it('reports versions, coverage and redactions per agent', () => {
    t = createHome();
    const [claude, codex] = runDoctor(t.environment).agents;
    expect(claude).toMatchObject({
      files: 2,
      parseErrors: 0,
      retentionDays: { value: 30, source: 'settings' },
    });
    expect(Object.fromEntries(claude?.versions ?? [])).toEqual({ '2.1.316': 2 });
    expect(claude?.unknown.size).toBe(0);
    expect(Object.fromEntries(codex?.versions ?? [])).toEqual({ '0.166.0': 2 });
    expect(claude?.redactions.get('github-token')).toBe(1);
  });

  it('names unknown record types, how often they appear and where first', () => {
    t = createHome({ unknownTypes: true });
    runArchive({ environment: t.environment });
    const report = runDoctor(t.environment);
    const claude = report.agents[0];
    expect(Object.fromEntries(claude?.unknown ?? [])).toEqual({
      'line:summary': {
        count: 1,
        example: 'claude-code/projects/-home-dev-acme/33333333-4444-4555-8666-777777777777.jsonl:1',
      },
      'block:server_tool_use': {
        count: 1,
        example: 'claude-code/projects/-home-dev-acme/33333333-4444-4555-8666-777777777777.jsonl:2',
      },
    });
    expect(claude?.parseErrors).toBe(1);
    expect(report.problems).toHaveLength(2);
    expect(renderDoctor(report)).toContain('line:summary x1');
  });

  it('warns loudly about unarchived logs the agent is about to delete', () => {
    t = createHome();
    const in29Days = Date.now() + 29 * 24 * 60 * 60 * 1000;
    expect(runDoctor(t.environment, in29Days).problems[0]).toMatch(
      /due for deletion by Claude Code within 7 days/,
    );
  });

  it('writes nothing: no index, no archive, no change to agent directories', () => {
    t = createHome();
    const claude = snapshotTree(join(t.home, '.claude'));
    runDoctor(t.environment);
    expect(existsSync(databasePath(t.environment))).toBe(false);
    expect(existsSync(join(t.home, '.nocap'))).toBe(false);
    expect(snapshotTree(join(t.home, '.claude'))).toEqual(claude);
  });
});

describe('findInstalled', () => {
  it('reads the version from the npm package behind the executable, without running it', () => {
    t = createHome();
    const pkg = join(t.home, 'lib/node_modules/@anthropic-ai/claude-code');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: '@anthropic-ai/claude-code', version: '2.1.316' }),
    );
    // Executing this would fail the test: it exits non-zero and prints a marker.
    writeFileSync(join(pkg, 'cli.js'), '#!/bin/sh\necho EXECUTED; exit 99\n');
    chmodSync(join(pkg, 'cli.js'), 0o755);
    mkdirSync(join(t.home, 'bin'));
    symlinkSync(join(pkg, 'cli.js'), join(t.home, 'bin/claude'));
    const environment = {
      ...t.environment,
      env: { ...t.environment.env, PATH: join(t.home, 'bin') },
    };
    expect(findInstalled('claude-code', environment)).toEqual({
      path: '~/bin/claude',
      version: '2.1.316',
    });
  });

  it('reads the version from a versioned install directory', () => {
    t = createHome();
    const release = join(t.home, '.local/share/claude/versions/2.1.316');
    mkdirSync(release, { recursive: true });
    writeFileSync(join(release, 'claude'), '');
    mkdirSync(join(t.home, 'bin'));
    symlinkSync(join(release, 'claude'), join(t.home, 'bin/claude'));
    const environment = {
      ...t.environment,
      env: { ...t.environment.env, PATH: join(t.home, 'bin') },
    };
    expect(findInstalled('claude-code', environment)?.version).toBe('2.1.316');
  });

  it('reports nothing when the agent is not on PATH', () => {
    t = createHome();
    expect(
      findInstalled('codex', { ...t.environment, env: { PATH: join(t.home, 'nowhere') } }),
    ).toBeUndefined();
  });
});
