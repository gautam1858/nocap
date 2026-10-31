import { isAbsolute, normalize, resolve } from 'node:path';
import { splitCommands } from '../adapters/shell.js';

export interface Danger {
  readonly rule: string;
  /** A one-line, evidence-bearing explanation of what tripped. */
  readonly reason: string;
}

// Top-level directories that no coding task should recursively delete.
const SYSTEM_ROOTS = new Set([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/home',
  '/lib',
  '/lib64',
  '/opt',
  '/proc',
  '/root',
  '/sbin',
  '/srv',
  '/sys',
  '/usr',
  '/var',
  '/System',
  '/Applications',
  '/Library',
  '/Users',
]);

function unquote(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  for (const ch of segment) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function stripWrappers(tokens: string[]): string[] {
  let t = tokens;
  while (
    t.length > 1 &&
    /^(?:sudo|doas|time|nice|nohup|env|command|exec|xargs)$/.test(t[0] ?? '')
  ) {
    t = t.slice(1);
    while (
      t.length > 0 &&
      (t[0]?.startsWith('-') || (t[0]?.includes('=') && !t[0].startsWith('/')))
    )
      t = t.slice(1);
  }
  return t;
}

/** A recursive-force rm whose target escapes the project directory. */
function checkRm(tokens: string[], projectDir: string | undefined): Danger | undefined {
  const t = stripWrappers(tokens);
  if (t[0] !== 'rm') return undefined;
  const flagTokens = t.slice(1).filter((x) => x.startsWith('-'));
  const short = (test: (c: string) => boolean): boolean =>
    flagTokens.some(
      (f) => /^-[A-Za-z]+$/.test(f) && (f.slice(1).match(/[A-Za-z]/g) ?? []).some(test),
    );
  const recursive = flagTokens.includes('--recursive') || short((c) => c === 'r' || c === 'R');
  const force = flagTokens.includes('--force') || short((c) => c === 'f');
  if (!recursive || !force) return undefined;

  const targets = t.slice(1).filter((x) => !x.startsWith('-'));
  for (const rawTarget of targets) {
    const target = unquote(rawTarget);
    const expanded = target.replace(/\$\{?HOME\}?|~(?=\/|$)/g, '~HOME~');
    if (
      target === '*' ||
      target === '/*' ||
      /^~(?:\/\*?|HOME)?$/.test(expanded) ||
      expanded.startsWith('~HOME~')
    ) {
      return {
        rule: 'destructive-rm',
        reason: `rm -rf targets the home directory or a wildcard root (${target})`,
      };
    }
    // An unexpanded variable can evaluate to empty and delete the root: rm -rf "$X/".
    if (/^\$\{?\w+\}?\/?\*?$/.test(target)) {
      return {
        rule: 'destructive-rm',
        reason: `rm -rf on an unchecked variable path (${target}); if it is empty this deletes /`,
      };
    }
    const cleaned = target.replace(/\*+$/, '').replace(/\/+$/, '') || '/';
    if (SYSTEM_ROOTS.has(cleaned)) {
      return { rule: 'destructive-rm', reason: `rm -rf targets a system directory (${target})` };
    }
    if (isAbsolute(target)) {
      if (projectDir !== undefined && !isInside(target, projectDir)) {
        return {
          rule: 'destructive-rm',
          reason: `rm -rf targets ${target}, which is outside the project (${projectDir})`,
        };
      }
      if (projectDir === undefined && SYSTEM_ROOTS.has(normalize(target))) {
        return { rule: 'destructive-rm', reason: `rm -rf targets a system path (${target})` };
      }
    } else if (projectDir !== undefined) {
      const resolved = resolve(projectDir, target);
      if (!isInside(resolved, projectDir)) {
        return {
          rule: 'destructive-rm',
          reason: `rm -rf escapes the project to ${resolved} via ${target}`,
        };
      }
    } else if (/(?:^|\/)\.\.(?:\/|$)/.test(target)) {
      return {
        rule: 'destructive-rm',
        reason: `rm -rf uses a path that climbs out of the working directory (${target})`,
      };
    }
  }
  return undefined;
}

function isInside(path: string, dir: string): boolean {
  const p = normalize(path);
  const d = normalize(dir).replace(/\/+$/, '');
  return p === d || p.startsWith(`${d}/`);
}

interface PatternRule {
  readonly rule: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

// Each pattern runs against a single command segment, lowercased where noted.
const PATTERNS: readonly PatternRule[] = [
  {
    rule: 'sql-drop',
    pattern: /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
    reason: 'a DROP/TRUNCATE on a database, table or schema',
  },
  {
    rule: 'infra-destroy',
    pattern:
      /\b(?:terraform|tofu)\s+(?:destroy|apply\s+-destroy)|\b(?:pulumi|cdk|cdktf|sst)\s+destroy\b/i,
    reason: 'an infrastructure destroy',
  },
  {
    rule: 'k8s-delete',
    pattern: /\bkubectl\s+delete\b|\bhelm\s+(?:delete|uninstall)\b/i,
    reason: 'a Kubernetes/Helm delete',
  },
  {
    rule: 'paas-delete',
    pattern:
      /\b(?:railway\s+(?:down|delete)|fly(?:ctl)?\s+(?:apps\s+)?destroy|heroku\s+apps:destroy|vercel\s+(?:remove|rm)|render\s+.*delete|supabase\s+db\s+reset)\b/i,
    reason: 'a hosting-platform delete or reset',
  },
  {
    rule: 'cloud-delete',
    pattern:
      /\baws\s+s3\s+rb\b|\baws\s+s3\s+rm\s+.*--recursive|\bgcloud\s+(?:\S+\s+){1,3}delete\b|\baz\s+(?:\S+\s+){1,3}delete\b/i,
    reason: 'a cloud resource delete',
  },
  {
    rule: 'docker-prune',
    pattern: /\bdocker\s+(?:system\s+prune\s+.*-a|volume\s+rm|volume\s+prune)\b/i,
    reason: 'a Docker volume or system prune',
  },
  {
    rule: 'force-push',
    pattern:
      /\bgit\s+push\b(?=.*(?:--force\b|(?:^|\s)-\w*f))(?!.*--force-with-lease)(?=.*\b(?:main|master|production|prod|release)\b)/i,
    reason: 'a git force-push to a protected branch',
  },
  {
    rule: 'branch-delete-remote',
    pattern: /\bgit\s+push\s+\S+\s+:(?:main|master|production|release)\b/i,
    reason: 'deleting a protected branch on the remote',
  },
  {
    rule: 'disk-wipe',
    pattern:
      /\bdd\s+[^|&;]*\bof=\/dev\/(?:sd|nvme|disk|hd)|\bmkfs(?:\.\w+)?\s+\/dev\/|>\s*\/dev\/(?:sd|nvme|disk)/i,
    reason: 'a raw write or format of a block device',
  },
  {
    rule: 'chmod-root',
    pattern: /\bchmod\s+-R\s+0?777\s+\/(?:\s|$)|\bchown\s+-R\s+\S+\s+\/(?:\s|$)/i,
    reason: 'a recursive permission change on /',
  },
  {
    rule: 'git-clean-all',
    pattern: /\bgit\s+clean\s+-\w*f\w*d\w*x|\bgit\s+clean\s+-\w*x\w*d?\w*f/i,
    reason: 'git clean removing ignored and untracked files',
  },
];

// Patterns that inherently span the separators splitCommands breaks on, so they
// are matched against the whole command line.
const WHOLE_COMMAND: readonly PatternRule[] = [
  {
    rule: 'fork-bomb',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:?\s*&\s*\}\s*;\s*:/,
    reason: 'a shell fork bomb',
  },
];

/** Inspects one shell command line for a destructive operation. */
export function checkCommand(command: string, projectDir: string | undefined): Danger | undefined {
  for (const { rule, pattern, reason } of WHOLE_COMMAND) {
    if (pattern.test(command))
      return { rule, reason: `${reason}: ${command.trim().slice(0, 120)}` };
  }
  for (const segment of splitCommands(command)) {
    const rm = checkRm(tokenize(segment), projectDir);
    if (rm) return rm;
    for (const { rule, pattern, reason } of PATTERNS) {
      if (pattern.test(segment))
        return { rule, reason: `${reason}: ${segment.trim().slice(0, 120)}` };
    }
    // DELETE FROM with no WHERE wipes a whole table.
    if (/\bdelete\s+from\s+\S+/i.test(segment) && !/\bwhere\b/i.test(segment)) {
      return {
        rule: 'sql-delete-all',
        reason: `a DELETE FROM with no WHERE clause: ${segment.trim().slice(0, 120)}`,
      };
    }
  }
  return undefined;
}
