export interface TestCommand {
  readonly runner: string;
  readonly segment: string;
}

/**
 * Splits a command line into the commands it runs, on && || ; | and newlines,
 * ignoring separators inside quotes and skipping heredoc bodies, which are data
 * rather than commands. Good enough for classification; not a shell parser.
 */
export function splitCommands(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  const heredocs: string[] = [];
  for (let i = 0; i < command.length; i++) {
    const ch = command.charAt(i);
    if (!quote && ch === '<' && command.startsWith('<<', i) && !command.startsWith('<<<', i)) {
      const marker = /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(command.slice(i));
      if (marker) {
        heredocs.push(marker[2] ?? '');
        current += marker[0];
        i += marker[0].length - 1;
        continue;
      }
    }
    if (!quote && ch === '\n' && heredocs.length > 0) {
      // Skip each pending heredoc body up to its terminator line.
      let rest = i + 1;
      for (const marker of heredocs.splice(0)) {
        const end = new RegExp(`^[\\t ]*${marker}[\\t ]*$`, 'm').exec(command.slice(rest));
        rest = end ? rest + end.index + end[0].length : command.length;
      }
      parts.push(current);
      current = '';
      i = rest - 1;
      continue;
    }
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"' && i + 1 < command.length) current += command.charAt(++i);
      else if (ch === quote) quote = undefined;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      parts.push(current);
      current = '';
      i++;
    } else if (ch === ';' || ch === '|' || ch === '\n') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

// Leading wrappers that do not change what runs.
const PREFIX =
  /^(?:(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)|(?:time|nice|nohup|sudo|env|command|exec|timeout\s+\S+|xvfb-run)\s+)*/;

const RUNNERS: readonly (readonly [string, RegExp])[] = [
  [
    'npm',
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+|run-script\s+)?(?:test|t|tests|test:[\w:.-]+|e2e|spec)(?:\s|$)/,
  ],
  // Aggregate scripts that conventionally run the suite as part of a wider gate.
  [
    'script',
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:check|ci|verify|validate)(?::[\w.-]+)?(?:\s|$)/,
  ],
  ['bun', /^bun\s+test\b/],
  ['vitest', /^(?:(?:npx|pnpx|bunx|yarn|pnpm(?:\s+exec)?)\s+)?vitest\b(?!\s+(?:init|--version)\b)/],
  ['jest', /^(?:(?:npx|pnpx|bunx|yarn|pnpm(?:\s+exec)?)\s+)?jest\b/],
  ['mocha', /^(?:(?:npx|pnpx|bunx|yarn)\s+)?mocha\b/],
  ['ava', /^(?:(?:npx|yarn)\s+)?ava\b/],
  ['playwright', /^(?:(?:npx|pnpx|bunx|yarn)\s+)?playwright\s+test\b/],
  ['cypress', /^(?:(?:npx|yarn)\s+)?cypress\s+run\b/],
  ['node-test', /^node\s+(?:.*\s)?--test\b/],
  ['deno', /^deno\s+test\b/],
  [
    'pytest',
    /^(?:(?:uv\s+run|poetry\s+run|pipenv\s+run|hatch\s+run|pdm\s+run|rye\s+run)\s+)?(?:python3?\s+-m\s+)?(?:pytest|py\.test)\b/,
  ],
  ['unittest', /^(?:python3?\s+-m\s+unittest|python3?\s+manage\.py\s+test)\b/],
  ['tox', /^(?:tox|nox)\b/],
  ['go', /^go\s+test\b/],
  ['cargo', /^cargo\s+(?:test|nextest\s+run)\b/],
  ['maven', /^(?:mvn|\.\/mvnw)\s+(?:.*\s)?(?:test|verify)\b/],
  ['gradle', /^(?:gradle|\.\/gradlew)\s+(?:.*\s)?(?:test|check)\b/],
  ['dotnet', /^dotnet\s+test\b/],
  ['rspec', /^(?:bundle\s+exec\s+)?rspec\b/],
  ['rails', /^(?:bundle\s+exec\s+)?(?:rails|rake)\s+(?:test|spec)\b/],
  ['phpunit', /^(?:\.\/)?(?:vendor\/bin\/)?(?:phpunit|pest)\b/],
  ['mix', /^mix\s+test\b/],
  ['swift', /^swift\s+test\b/],
  ['ctest', /^ctest\b/],
  ['make', /^make\s+(?:.*\s)?(?:test|check|tests)\b/],
  ['just', /^just\s+test\b/],
  ['zig', /^zig\s+build\s+test\b/],
  ['flutter', /^(?:flutter|dart)\s+test\b/],
  ['sbt', /^sbt\s+(?:.*\s)?test\b/],
];

/** The first segment of a command line that runs a test suite, if any. */
export function detectTestCommand(command: string): TestCommand | undefined {
  for (const raw of splitCommands(command)) {
    const segment = raw.replace(PREFIX, '');
    for (const [runner, pattern] of RUNNERS) {
      if (pattern.test(segment)) return { runner, segment: raw };
    }
  }
  return undefined;
}
