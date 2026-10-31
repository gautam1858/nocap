import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { renderReviewMarkdown, reviewDiff } from '../../report/review.js';
import { ExitCode, type Io } from '../io.js';

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

export function reviewCommand(args: readonly string[], io: Io): number {
  let values: { diff?: string; json?: boolean; 'fail-on-findings'?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...args],
      options: {
        diff: { type: 'string' },
        json: { type: 'boolean' },
        'fail-on-findings': { type: 'boolean' },
      },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`nocap review: ${error instanceof Error ? error.message : String(error)}\n`);
    return ExitCode.usage;
  }

  let diff: string;
  try {
    diff = values.diff !== undefined ? readFileSync(values.diff, 'utf8') : readStdin();
  } catch (error) {
    io.stderr.write(
      `nocap review: cannot read diff: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return ExitCode.failure;
  }

  const review = reviewDiff(diff);
  io.stdout.write(
    values.json ? `${JSON.stringify(review, null, 2)}\n` : renderReviewMarkdown(review),
  );
  return values['fail-on-findings'] && review.findings.length > 0 ? ExitCode.failure : ExitCode.ok;
}
