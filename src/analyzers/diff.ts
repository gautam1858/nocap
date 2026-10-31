import type { FileChange } from '../core/event.js';

export interface ChangeLines {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

/**
 * The added and removed lines of one file change, from whichever representation
 * the adapter captured: before/after text (Claude Code) or a patch body (Codex).
 */
export function changeLines(change: FileChange): ChangeLines {
  if (change.op === 'delete') {
    return { added: [], removed: (change.before ?? '').split('\n') };
  }
  if (change.patch !== undefined) {
    const added: string[] = [];
    const removed: string[] = [];
    for (const line of change.patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added.push(line.slice(1));
      else if (line.startsWith('-') && !line.startsWith('---')) removed.push(line.slice(1));
    }
    return { added, removed };
  }
  const before = change.before ?? '';
  const after = change.after ?? '';
  // A create has no before; an update replaces before with after. We don't need
  // a real LCS diff: the testwash rules compare counts and look for markers, and
  // lines present in both are a wash either way.
  const beforeLines = before ? before.split('\n') : [];
  const afterLines = after ? after.split('\n') : [];
  const beforeSet = new Map<string, number>();
  for (const line of beforeLines) beforeSet.set(line, (beforeSet.get(line) ?? 0) + 1);
  const afterSet = new Map<string, number>();
  for (const line of afterLines) afterSet.set(line, (afterSet.get(line) ?? 0) + 1);
  const added = afterLines.filter((line) => {
    const remaining = beforeSet.get(line) ?? 0;
    if (remaining > 0) {
      beforeSet.set(line, remaining - 1);
      return false;
    }
    return true;
  });
  const removed = beforeLines.filter((line) => {
    const remaining = afterSet.get(line) ?? 0;
    if (remaining > 0) {
      afterSet.set(line, remaining - 1);
      return false;
    }
    return true;
  });
  return { added, removed };
}
