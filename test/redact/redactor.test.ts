import { describe, expect, it } from 'vitest';
import { isSecretsPath, printsSecrets, Redactor } from '../../src/redact/redactor.js';

// Credential-shaped strings are assembled at runtime so that none appears
// literally in the repository.
const j = (...parts: string[]): string => parts.join('');
const rep = (ch: string, n: number): string => ch.repeat(n);

const SECRETS: readonly (readonly [string, string])[] = [
  ['anthropic-key', j('sk-', 'ant-', 'api03-', rep('A', 40))],
  ['openai-key', j('sk-', 'proj-', rep('b', 40))],
  ['github-token', j('gh', 'p_', rep('C', 36))],
  ['github-token', j('github', '_pat_', rep('d', 60))],
  ['gitlab-token', j('gl', 'pat-', rep('e', 20))],
  ['slack-token', j('xo', 'xb-', '1234567890-', rep('f', 24))],
  ['slack-webhook', j('https://hooks.', 'slack.com/services/', 'T000/B000/', rep('g', 24))],
  ['stripe-key', j('sk', '_live_', rep('h', 24))],
  ['aws-access-key', j('AK', 'IA', rep('Q', 16))],
  ['google-api-key', j('AI', 'za', rep('i', 35))],
  ['npm-token', j('np', 'm_', rep('j', 36))],
  ['pypi-token', j('py', 'pi-', rep('k', 60))],
  ['huggingface-token', j('h', 'f_', rep('l', 34))],
  ['sendgrid-key', j('S', 'G.', rep('m', 22), '.', rep('n', 43))],
  ['jwt', j('ey', 'J', rep('o', 20), '.ey', 'J', rep('p', 20), '.', rep('q', 20))],
  [
    'private-key',
    j('-----BEGIN ', 'RSA PRIVATE KEY-----\n', rep('r', 64), '\n-----END ', 'RSA PRIVATE KEY-----'),
  ],
];

describe('Redactor', () => {
  it.each(SECRETS)('removes a %s', (kind, secret) => {
    const redactor = new Redactor();
    const text = redactor.text(`before ${secret} after`);
    expect(text).toBe(`before [REDACTED:${kind}] after`);
    expect(redactor.counts.get(kind)).toBe(1);
  });

  it('removes a private key whose END marker was cut off by truncation', () => {
    const text = new Redactor().text(j('-----BEGIN ', 'OPENSSH PRIVATE KEY-----\n', rep('s', 200)));
    expect(text).toBe('[REDACTED:private-key]');
  });

  it('keeps the scheme, user and host of a URL but not its password', () => {
    const redactor = new Redactor();
    expect(
      redactor.text(j('DATABASE_URL=postgres://app:', 'hunter2hunter2', '@db.internal:5432/prod')),
    ).toBe('DATABASE_URL=postgres://app:[REDACTED:url-credentials]@db.internal:5432/prod');
  });

  it('keeps the header name of an Authorization header', () => {
    const text = new Redactor().text(
      j('curl -H "Authorization: Bearer ', rep('t', 32), '" https://api.example.com'),
    );
    expect(text).toBe(
      'curl -H "Authorization: Bearer [REDACTED:bearer-token]" https://api.example.com',
    );
  });

  it.each([
    [j('export API_KEY=', 'a1b2c3d4e5f6'), 'export API_KEY=[REDACTED:secret-assignment]'],
    [j('password: "', 'correcthorsebattery', '"'), 'password: "[REDACTED:secret-assignment]"'],
    [
      j('{"client_secret": "', 'x9y8z7w6v5', '"}'),
      '{"client_secret": "[REDACTED:secret-assignment]"}',
    ],
    [j('GITHUB_TOKEN=', 'abc123def456ghi'), 'GITHUB_TOKEN=[REDACTED:secret-assignment]'],
  ])('removes assigned secrets: %s', (input, expected) => {
    expect(new Redactor().text(input)).toBe(expected);
  });

  it.each([
    'readonly tokens: TokenUsage;',
    'max_tokens: 4096',
    'const token = getToken();',
    'API_KEY=${API_KEY}',
    'password: process.env.DB_PASSWORD',
    'tokenizer: "cl100k_base"',
    'password_hash = bcrypt(pw)',
    'Use TOKEN=<your token here>',
    'the key is stored in .env, see sk-learn docs',
    'git log --format=%H',
    'sha256: 3f786850e387550fdab836ed7e6dc881de23001b',
    'postgres://app@db.internal:5432/prod',
  ])('leaves ordinary text alone: %s', (input) => {
    const redactor = new Redactor();
    expect(redactor.text(input)).toBe(input);
    expect(redactor.changes).toBe(0);
  });

  it('blanks values of secret-named JSON fields', () => {
    const redactor = new Redactor();
    expect(
      redactor.value({
        apiKey: 'plainlookingvalue',
        name: 'plainlookingvalue',
        max_tokens: 'unbounded',
      }),
    ).toEqual({
      apiKey: '[REDACTED:secret-field]',
      name: 'plainlookingvalue',
      max_tokens: 'unbounded',
    });
  });

  it('scrubs every KEY=value line of a secrets file, whatever the key', () => {
    const redactor = new Redactor();
    const env = j(
      '     1→DB_HOST=db.internal\n',
      '     2→STRIPE=',
      'whatever-it-is\n',
      '     3→# comment\n',
    );
    expect(redactor.text(env, true)).toBe(
      '     1→DB_HOST=[REDACTED:secrets-file]\n     2→STRIPE=[REDACTED:secrets-file]\n     3→# comment\n',
    );
  });

  it('rewrites the home directory as ~ without touching lookalike paths', () => {
    const redactor = new Redactor({ home: '/home/dev' });
    expect(redactor.text('/home/dev/acme and /home/developer/x and "/home/dev"')).toBe(
      '~/acme and /home/developer/x and "~"',
    );
  });

  it('never rewrites everything when home is the filesystem root', () => {
    expect(new Redactor({ home: '/' }).text('/usr/bin/env')).toBe('/usr/bin/env');
  });

  it('is idempotent', () => {
    const redactor = new Redactor({ home: '/home/dev' });
    const once = redactor.text(j('token=', 'abc123def456ghi', ' at /home/dev/x'));
    expect(new Redactor({ home: '/home/dev' }).text(once)).toBe(once);
  });
});

describe('secrets files', () => {
  it.each([
    ['/repo/.env', true],
    ['.env.local', true],
    ['~/.aws/credentials', true],
    ['/repo/.npmrc', true],
    ['.env.example', false],
    ['.env.sample', false],
    ['src/env.ts', false],
    ['docs/.environment.md', false],
  ])('%s is a secrets file: %s', (path, expected) => {
    expect(isSecretsPath(path)).toBe(expected);
  });

  it.each([
    ['cat .env', true],
    ['cat ./config/.env.production', true],
    ['grep DB_ .env.local | head', true],
    ['cd app && source .env && npm start', true],
    ['printenv', true],
    ['printenv | sort', true],
    ['cat .env.example', false],
    ['ls -la .env', false],
    ['echo .env >> .gitignore', false],
    ["grep -n '^\\.env' .gitignore", false],
    ['env NODE_ENV=test npm test', false],
    ["python3 - <<'EOF'\nenv\nEOF", false],
  ])('%s prints secrets: %s', (command, expected) => {
    expect(printsSecrets(command)).toBe(expected);
  });
});
