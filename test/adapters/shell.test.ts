import { describe, expect, it } from 'vitest';
import { detectTestCommand, splitCommands } from '../../src/adapters/shell.js';

describe('splitCommands', () => {
  it.each([
    ['npm test', ['npm test']],
    ['cd app && npm test 2>&1 | tail -20', ['cd app', 'npm test 2>&1', 'tail -20']],
    ['echo "a && b"; ls', ['echo "a && b"', 'ls']],
    ["grep -E 'x|y' f", ["grep -E 'x|y' f"]],
    ["python3 - <<'EOF'\nimport os; print(1)\nEOF\nnpm test", ["python3 - <<'EOF'", 'npm test']],
    ['cat <<EOF > notes.txt\na | b\nEOF', ['cat <<EOF > notes.txt']],
  ])('%j', (command, expected) => {
    expect(splitCommands(command)).toEqual(expected);
  });
});

describe('detectTestCommand', () => {
  it.each([
    ['npm test', 'npm'],
    ['npm run test:unit -- --watch=false', 'npm'],
    ['pnpm test', 'npm'],
    ['yarn test --ci', 'npm'],
    ['bun test', 'npm'],
    ['npx vitest run test/auth.test.ts', 'vitest'],
    ['vitest', 'vitest'],
    ['npx jest -t "expired tokens"', 'jest'],
    ['node --test test/', 'node-test'],
    ['pytest -k auth -x', 'pytest'],
    ['python -m pytest tests/unit', 'pytest'],
    ['uv run pytest', 'pytest'],
    ['python manage.py test', 'unittest'],
    ['go test ./...', 'go'],
    ['cargo test --lib', 'cargo'],
    ['cargo nextest run', 'cargo'],
    ['./gradlew test', 'gradle'],
    ['mvn -q test', 'maven'],
    ['bundle exec rspec spec/models', 'rspec'],
    ['vendor/bin/phpunit', 'phpunit'],
    ['dotnet test', 'dotnet'],
    ['make test', 'make'],
    ['CI=1 npm test', 'npm'],
    ['cd api && pytest -q 2>&1 | tail -5', 'pytest'],
    ['npx playwright test', 'playwright'],
  ])('%s runs tests with %s', (command, runner) => {
    expect(detectTestCommand(command)?.runner).toBe(runner);
  });

  it.each([
    'npm install',
    'npm run build',
    'git commit -m "fix tests"',
    'cat test/auth.test.ts',
    'grep -r pytest .',
    'npx vitest --version',
    "python3 - <<'EOF'\nimport pytest\nEOF",
    'echo "run pytest later"',
  ])('%s does not run tests', (command) => {
    expect(detectTestCommand(command)).toBeUndefined();
  });

  it('returns the segment that runs the tests', () => {
    expect(detectTestCommand('cd api && npm test -- -t auth | tail -5')?.segment).toBe(
      'npm test -- -t auth',
    );
  });
});
