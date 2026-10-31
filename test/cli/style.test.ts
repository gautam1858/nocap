import { describe, expect, it } from 'vitest';
import { colorEnabled, field, plain, styleFor } from '../../src/cli/style.js';
import { runCli } from '../support/cli.js';

const ESC = '\u001b[';

describe('colour', () => {
  it.each([
    [{ isTTY: true }, {}, true],
    [{ isTTY: false }, {}, false],
    [{}, {}, false],
    [{ isTTY: true }, { NO_COLOR: '1' }, false],
    [{ isTTY: true }, { NO_COLOR: '' }, true],
    [{ isTTY: false }, { FORCE_COLOR: '1' }, true],
    [{ isTTY: true }, { FORCE_COLOR: '0' }, false],
    [{ isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '1' }, false],
    [{ isTTY: true }, { TERM: 'dumb' }, false],
  ])('stream %j with env %j: %s', (stream, env, expected) => {
    expect(colorEnabled(stream, env)).toBe(expected);
  });

  it('aligns report rows identically with and without colour', () => {
    const coloured = field(styleFor({ isTTY: true }, {}), 'logs', 'x');
    expect(coloured.replace(new RegExp(`${ESC.replace('[', '\\[')}[0-9;]*m`, 'g'), '')).toBe(
      field(plain, 'logs', 'x'),
    );
    expect(field(plain, 'logs', 'x')).toBe('  logs      x');
  });

  it('is off when output is piped, and on when forced', () => {
    expect(runCli(['--help']).stdout).not.toContain(ESC);
    expect(runCli(['--help'], { env: { FORCE_COLOR: '1' } }).stdout).toContain(ESC);
    expect(runCli(['--help'], { env: { FORCE_COLOR: '1', NO_COLOR: '1' } }).stdout).not.toContain(
      ESC,
    );
  });
});
