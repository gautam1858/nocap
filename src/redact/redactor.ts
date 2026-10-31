import {
  DOTENV_LINE,
  ENV_DUMP_SEGMENT,
  isPlausibleSecretValue,
  NETRC_PASSWORD,
  RULES,
  SECRET_NAME_EXACT,
  SECRETS_PATH,
  SECRETS_READ_SEGMENT,
} from './rules.js';
import { splitCommands } from '../adapters/shell.js';

/** Bump when rules change, so archived copies are re-scanned with the new rules. */
export const REDACTION_VERSION = 1;

export const placeholder = (kind: string): string => `[REDACTED:${kind}]`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface RedactorOptions {
  /** Absolute home directory to rewrite as `~`. */
  readonly home?: string;
}

/**
 * Scrubs secrets from text and JSON values. Counts what it removed by kind,
 * never what the secret was.
 */
export class Redactor {
  readonly #counts = new Map<string, number>();
  readonly #home: RegExp | undefined;
  #changes = 0;

  constructor(options: RedactorOptions = {}) {
    const home = options.home?.replace(/[/\\]+$/, '');
    // A home of "/" or "" would rewrite every absolute path.
    this.#home =
      home && home.length > 1
        ? new RegExp(`(?<![A-Za-z0-9_.~-])${escapeRegExp(home)}(?=[/\\\\"'\\s:;,)\\]}]|$)`, 'g')
        : undefined;
  }

  get counts(): ReadonlyMap<string, number> {
    return this.#counts;
  }

  /** Increases whenever any text is altered, home-path rewrites included. */
  get changes(): number {
    return this.#changes;
  }

  #count(kind: string): void {
    this.#counts.set(kind, (this.#counts.get(kind) ?? 0) + 1);
    this.#changes++;
  }

  /** @param secretsFile The text is known to be the contents of a secrets file such as `.env`. */
  text(input: string, secretsFile = false): string {
    let text = input;
    if (text.length >= 8) {
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        if (!rule.pattern.test(text)) continue;
        rule.pattern.lastIndex = 0;
        text = text.replace(rule.pattern, (whole: string, ...rest: unknown[]) => {
          const [before, secret, after] = rest as (string | undefined)[];
          if (
            rule.validate &&
            !rule.validate(rule.hasContext ? (secret ?? '') : whole, before ?? '')
          ) {
            return whole;
          }
          this.#count(rule.kind);
          return rule.hasContext
            ? `${before ?? ''}${placeholder(rule.kind)}${typeof after === 'string' ? after : ''}`
            : placeholder(rule.kind);
        });
      }
      if (secretsFile) {
        text = text.replace(DOTENV_LINE, (whole, key: string, value: string) => {
          if (value.startsWith('[REDACTED')) return whole;
          this.#count('secrets-file');
          return `${key}${placeholder('secrets-file')}`;
        });
        text = text.replace(NETRC_PASSWORD, (_whole, key: string) => {
          this.#count('secrets-file');
          return `${key}${placeholder('secrets-file')}`;
        });
      }
    }
    if (!this.#home) return text;
    const rewritten = text.replace(this.#home, '~');
    if (rewritten !== text) this.#changes++;
    return rewritten;
  }

  /** Deep copy of a JSON value with every string scrubbed and secret-named fields blanked. */
  value(input: unknown, secretsFile = false): unknown {
    if (typeof input === 'string') return this.text(input, secretsFile);
    if (Array.isArray(input)) return input.map((item) => this.value(item, secretsFile));
    if (input && typeof input === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(input)) {
        if (
          typeof value === 'string' &&
          SECRET_NAME_EXACT.test(key) &&
          isPlausibleSecretValue(value)
        ) {
          this.#count('secret-field');
          out[key] = placeholder('secret-field');
        } else {
          out[key] = this.value(value, secretsFile);
        }
      }
      return out;
    }
    return input;
  }
}

/** A path such as `.env.local` or `~/.aws/credentials`. */
export function isSecretsPath(path: string): boolean {
  return SECRETS_PATH.test(path.trim());
}

/** A command line that prints a secrets file or the whole environment. */
export function printsSecrets(command: string): boolean {
  return splitCommands(command).some(
    (segment) => ENV_DUMP_SEGMENT.test(segment) || SECRETS_READ_SEGMENT.test(segment),
  );
}
