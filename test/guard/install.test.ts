import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claudeSettingsPath,
  installGuard,
  isInstalled,
  uninstallGuard,
} from '../../src/guard/install.js';
import type { GuardEnv } from '../../src/guard/paths.js';

let home: string;
let e: GuardEnv;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'nocap-install-'));
  e = { home, env: { HOME: home } };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function settings(): Record<string, unknown> {
  return JSON.parse(readFileSync(claudeSettingsPath(e, 'user'), 'utf8')) as Record<string, unknown>;
}

describe('guard install', () => {
  it('creates settings.json with the hooks when none exists', () => {
    const result = installGuard(e, 'user', false);
    expect(result.existed).toBe(false);
    expect(result.backup).toBeUndefined();
    const hooks = settings().hooks as Record<string, unknown>;
    expect(hooks).toHaveProperty('PreToolUse');
    expect(hooks).toHaveProperty('UserPromptSubmit');
    expect(isInstalled(e, 'user')).toBe(true);
  });

  it('preserves existing hooks and backs up the file', () => {
    const path = claudeSettingsPath(e, 'user');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        model: 'opus',
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep' }] }],
        },
      }),
    );
    const result = installGuard(e, 'user', false);
    expect(result.backup).toBeDefined();
    expect(JSON.stringify(settings())).toContain('echo keep');
    expect(settings().model).toBe('opus');
  });

  it('is idempotent: installing twice does not duplicate the hook', () => {
    installGuard(e, 'user', false);
    installGuard(e, 'user', false);
    const pre = (settings().hooks as { PreToolUse: unknown[] }).PreToolUse;
    expect(pre.filter((g) => JSON.stringify(g).includes('guard/hook.js'))).toHaveLength(1);
  });

  it('uninstall removes exactly our hooks and leaves others', () => {
    const path = claudeSettingsPath(e, 'user');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo keep' }] }],
        },
      }),
    );
    installGuard(e, 'user', false);
    const result = uninstallGuard(e, 'user', false);
    expect(result.removed).toBe(2);
    expect(JSON.stringify(settings())).toContain('echo keep');
    expect(JSON.stringify(settings())).not.toContain('guard/hook.js');
    expect(isInstalled(e, 'user')).toBe(false);
  });

  it('uninstall is a no-op when the guard is not installed', () => {
    expect(uninstallGuard(e, 'user', false).removed).toBe(0);
  });

  it('dry run writes nothing', () => {
    installGuard(e, 'user', true);
    expect(isInstalled(e, 'user')).toBe(false);
  });
});
