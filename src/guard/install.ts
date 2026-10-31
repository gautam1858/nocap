import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '../adapters/types.js';
import type { GuardEnv } from './paths.js';

export const HOOK_EVENTS = ['PreToolUse', 'UserPromptSubmit'] as const;

/** Identifies a hook entry as ours, so install is idempotent and uninstall is exact. */
function isOurs(command: string): boolean {
  return command.includes('guard/hook.js') && /nocap/i.test(command);
}

export function hookPath(): string {
  return fileURLToPath(new URL('../guard/hook.js', import.meta.url));
}

export function hookCommand(): string {
  // Quote the path so a space in it survives the shell the agent runs it in.
  return `node "${hookPath()}"`;
}

export function claudeSettingsPath(e: GuardEnv, scope: 'user' | 'project'): string {
  if (scope === 'project')
    return join(e.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.claude', 'settings.json');
  return join(e.env.CLAUDE_CONFIG_DIR ?? join(e.home, '.claude'), 'settings.json');
}

interface HookHandler {
  type: 'command';
  command: string;
}
interface HookGroup {
  matcher?: string;
  hooks: HookHandler[];
}
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>;

function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(raw)) throw new Error(`${path} is not a JSON object`);
  return raw;
}

/** Removes our hook entries from a settings object, leaving everyone else's intact. */
function stripOurs(settings: Settings): { settings: Settings; removed: number } {
  let removed = 0;
  const hooks = settings.hooks;
  if (!isRecord(hooks)) return { settings, removed };
  const next: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      next[event] = groups as HookGroup[];
      continue;
    }
    const kept = groups
      .map((group) => {
        if (!isRecord(group) || !Array.isArray(group.hooks)) return group;
        const before = group.hooks.length;
        const hooksKept = group.hooks.filter(
          (h) => !(isRecord(h) && typeof h.command === 'string' && isOurs(h.command)),
        );
        removed += before - hooksKept.length;
        return { ...group, hooks: hooksKept };
      })
      .filter((group) => !isRecord(group) || !Array.isArray(group.hooks) || group.hooks.length > 0);
    if (kept.length > 0) next[event] = kept;
  }
  return { settings: { ...settings, hooks: next }, removed };
}

function addOurs(settings: Settings): Settings {
  const { settings: clean } = stripOurs(settings);
  const hooks: Record<string, HookGroup[]> = { ...(clean.hooks ?? {}) };
  const handler: HookHandler = { type: 'command', command: hookCommand() };
  for (const event of HOOK_EVENTS) {
    const group: HookGroup =
      event === 'UserPromptSubmit' ? { hooks: [handler] } : { matcher: '', hooks: [handler] };
    hooks[event] = [...(hooks[event] ?? []), group];
  }
  return { ...clean, hooks };
}

export interface InstallResult {
  readonly path: string;
  readonly existed: boolean;
  readonly backup?: string;
  readonly events: readonly string[];
}

function writeSettings(path: string, settings: Settings, dryRun: boolean): string | undefined {
  if (dryRun) return undefined;
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (existsSync(path)) {
    backup = `${path}.nocap-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    copyFileSync(path, backup);
  }
  const tmp = `${path}.tmp-${String(process.pid)}`;
  writeFileSync(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  renameSync(tmp, path);
  return backup;
}

export function installGuard(
  e: GuardEnv,
  scope: 'user' | 'project',
  dryRun: boolean,
): InstallResult {
  const path = claudeSettingsPath(e, scope);
  const existed = existsSync(path);
  const settings = addOurs(existed ? readSettings(path) : {});
  const backup = writeSettings(path, settings, dryRun);
  return { path, existed, ...(backup !== undefined ? { backup } : {}), events: HOOK_EVENTS };
}

export interface UninstallResult {
  readonly path: string;
  readonly removed: number;
  readonly backup?: string;
}

export function uninstallGuard(
  e: GuardEnv,
  scope: 'user' | 'project',
  dryRun: boolean,
): UninstallResult {
  const path = claudeSettingsPath(e, scope);
  if (!existsSync(path)) return { path, removed: 0 };
  const { settings, removed } = stripOurs(readSettings(path));
  if (removed === 0) return { path, removed: 0 };
  const backup = writeSettings(path, settings, dryRun);
  return { path, removed, ...(backup !== undefined ? { backup } : {}) };
}

export function isInstalled(e: GuardEnv, scope: 'user' | 'project'): boolean {
  const path = claudeSettingsPath(e, scope);
  if (!existsSync(path)) return false;
  try {
    return JSON.stringify(readSettings(path)).includes('guard/hook.js');
  } catch {
    return false;
  }
}
