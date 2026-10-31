import { splitCommands } from '../adapters/shell.js';
import type { EventOf } from '../core/event.js';
import { isTestFile } from './testfiles.js';

export interface Scope {
  readonly narrowed: boolean;
  /** Why the run doesn't cover the whole suite, when it doesn't. */
  readonly reason?: string;
}

// Flags that select a subset of tests.
const FILTER_FLAG =
  /(?:^|\s)(?:-k|-m|-t|-g|-e|-run|--run|--grep|--fgrep|--filter|--testNamePattern|--test-name-pattern|--testPathPattern|--test(?:s)?=|--only|--name|-n|--spec)\b/i;

// A pipe into one of these masks the test's own exit code (the shell reports the
// pipe's status), so a "pass" read from it cannot be trusted.
const MASKING_PIPE = /\|\s*(?:head|tail|grep|egrep|rg|cat|less|more|tee|sed|awk)\b/;

function namesSubsetPath(segment: string): string | undefined {
  // A path argument that points at a specific test file or a pytest node id.
  for (const token of segment.split(/\s+/).slice(1)) {
    if (token.startsWith('-')) continue;
    const path = token.split('::')[0] ?? token;
    if ((isTestFile(path) && !token.includes('*')) || token.includes('::')) return token;
  }
  return undefined;
}

export function testScope(run: Pick<EventOf<'test_run'>['payload'], 'command' | 'segment'>): Scope {
  const { command, segment } = run;

  // Does the test command's output feed a masking pipe? Look at what follows the
  // test segment in the original command line.
  const after = command.slice(command.indexOf(segment) + segment.length);
  if (MASKING_PIPE.test(after) || MASKING_PIPE.test(command)) {
    // `npm test` on its own, then `| tail`, means the recorded exit code is tail's.
    const stages = splitCommands(command);
    const testStageIndex = stages.findIndex((s) => s.includes(segment.split(/\s+/)[0] ?? segment));
    if (testStageIndex !== -1 && testStageIndex < stages.length - 1) {
      return {
        narrowed: true,
        reason:
          'output piped to another command, so the exit code is the pipe’s, not the test run’s',
      };
    }
  }

  if (FILTER_FLAG.test(segment)) {
    return { narrowed: true, reason: 'ran a filtered subset of tests, not the whole suite' };
  }

  // The command is already known to run tests (it produced a test_run). If it
  // also names a specific test file or node id, it ran only that.
  const subset = namesSubsetPath(segment);
  if (subset !== undefined) {
    return { narrowed: true, reason: `ran only ${subset}, not the whole suite` };
  }

  return { narrowed: false };
}
