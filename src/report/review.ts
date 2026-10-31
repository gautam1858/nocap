import { inspectTestChange, type RawFinding } from '../analyzers/testwash.js';
import { isTestFile } from '../analyzers/testfiles.js';

export interface DiffFile {
  readonly path: string;
  readonly op: 'add' | 'delete' | 'modify' | 'rename';
  readonly added: string[];
  readonly removed: string[];
}

/** Parses a unified `git diff` into per-file added/removed lines. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | undefined;
  let op: DiffFile['op'] = 'modify';
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      op = 'modify';
      current = undefined;
      continue;
    }
    if (line.startsWith('new file mode')) op = 'add';
    else if (line.startsWith('deleted file mode')) op = 'delete';
    else if (line.startsWith('rename ')) op = 'rename';
    else if (line.startsWith('+++ ')) {
      const path = line.slice(4).replace(/^b\//, '').trim();
      if (path !== '/dev/null') {
        current = { path, op, added: [], removed: [] };
        files.push(current);
      }
    } else if (line.startsWith('--- ') && op === 'delete') {
      const path = line.slice(4).replace(/^a\//, '').trim();
      if (path !== '/dev/null') {
        current = { path, op, added: [], removed: [] };
        files.push(current);
      }
    } else if (current && line.startsWith('+') && !line.startsWith('+++')) {
      current.added.push(line.slice(1));
    } else if (current && line.startsWith('-') && !line.startsWith('---')) {
      current.removed.push(line.slice(1));
    }
  }
  return files;
}

export interface ReviewFinding extends RawFinding {
  readonly path: string;
}

export interface Review {
  readonly filesChanged: number;
  readonly testFilesChanged: number;
  readonly findings: readonly ReviewFinding[];
}

export function reviewDiff(diff: string): Review {
  const files = parseUnifiedDiff(diff);
  const testFiles = files.filter((f) => isTestFile(f.path));
  const findings: ReviewFinding[] = [];
  for (const file of testFiles) {
    const op = file.op === 'delete' ? 'delete' : 'other';
    for (const raw of inspectTestChange(file.path, op, file.added, file.removed)) {
      findings.push({ ...raw, path: file.path });
    }
  }
  return { filesChanged: files.length, testFilesChanged: testFiles.length, findings };
}

const KIND_LABEL: Record<RawFinding['kind'], string> = {
  'test-skipped': 'test skipped',
  'test-file-deleted': 'test file deleted',
  'assertions-removed': 'assertions removed',
  'expected-changed': 'expected value changed',
};

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** A PR comment, in GitHub-flavoured markdown. */
export function renderReviewMarkdown(review: Review): string {
  const out: string[] = ['### 🪪 nocap review', ''];
  if (review.findings.length === 0) {
    out.push(
      `✅ No tests were skipped, deleted or weakened in this diff. ` +
        `(${String(review.filesChanged)} file(s) changed, ${String(review.testFilesChanged)} test file(s).)`,
    );
  } else {
    out.push(
      `⚠️ **${String(review.findings.length)} test-integrity finding(s) in this diff.**`,
      '',
    );
    out.push('| File | Finding |', '| --- | --- |');
    for (const f of review.findings) {
      out.push(
        `| \`${escapeCell(f.path)}\` | **${KIND_LABEL[f.kind]}** — ${escapeCell(f.detail)} |`,
      );
    }
    out.push(
      '',
      '<sub>nocap only looked at the diff — it can’t tell whether these are justified. ' +
        'If they are, carry on. This is not a merge blocker.</sub>',
    );
  }
  out.push('', '<sub>— [nocap](https://github.com/gautam1858/nocap), 100% local</sub>');
  return `${out.join('\n')}\n`;
}
