export interface Rule {
  readonly kind: string;
  readonly pattern: RegExp;
  /**
   * For rules with context around the secret (the key in KEY=value, the scheme
   * and user in a URL): group 1 is kept before, group 2 is the secret, and
   * group 3, if present, is kept after.
   */
  readonly hasContext?: true;
  /** Rejects matches whose secret group is obviously not a secret. */
  readonly validate?: (secret: string, before: string) => boolean;
}

// Word-ish names that mark a value as a secret in KEY=value, key: value and JSON fields.
// The suffix list is deliberately short: "tokenizer" or "password_hash" are not secrets.
// "token" takes no plural: `tokens`, `max_tokens` and `input_tokens` are counts.
const SECRET_NAME =
  '[A-Za-z0-9_.-]*?(?:(?:secret|passw(?:or)?d|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|credential|connection[_-]?string|database[_-]?url|dsn)(?:s|[_-]?id|[_-]?key|[_-]?value)?|token(?:[_-]?id|[_-]?key|[_-]?value)?)';

export const SECRET_NAME_EXACT = new RegExp(`^${SECRET_NAME}$`, 'i');

/** Values that look like placeholders, references or plain data rather than secrets. */
export function isPlausibleSecretValue(value: string): boolean {
  if (value.length < 8) return false;
  if (value.startsWith('[REDACTED')) return false;
  if (/^(?:\$|<|\{\{|%|process\.env|os\.environ|env\.|ENV\[|\/|\.\/|~\/|\*{3,})/.test(value)) {
    return false;
  }
  if (/^[\d.,_-]+$/.test(value)) return false;
  if (/^(?:true|false|null|none|undefined|string|number|boolean|required|optional)$/i.test(value)) {
    return false;
  }
  return true;
}

/**
 * Ordered: specific token formats first, so a key=sk-ant-... value is labelled
 * as an Anthropic key rather than a generic assignment.
 */
export const RULES: readonly Rule[] = [
  {
    kind: 'private-key',
    pattern:
      /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?(?:-----END \1-----|$)/g,
  },
  { kind: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  {
    kind: 'github-token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})/g,
  },
  { kind: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'slack-webhook', pattern: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
  {
    kind: 'stripe-key',
    pattern: /\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{24,})/g,
  },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g },
  { kind: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'pypi-token', pattern: /\bpypi-[A-Za-z0-9_-]{50,}/g },
  { kind: 'huggingface-token', pattern: /\bhf_[A-Za-z0-9]{30,}\b/g },
  { kind: 'sendgrid-key', pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g },
  { kind: 'digitalocean-token', pattern: /\bdo[por]_v1_[a-f0-9]{64}\b/g },
  { kind: 'shopify-token', pattern: /\bshp(?:at|ca|pa|ss)_[a-fA-F0-9]{32}\b/g },
  { kind: 'supabase-token', pattern: /\bsbp_[a-f0-9]{40}\b/g },
  { kind: 'linear-key', pattern: /\blin_api_[A-Za-z0-9]{40}\b/g },
  { kind: 'doppler-token', pattern: /\bdp\.(?:pt|st|sa|ct)\.[A-Za-z0-9]{40,}/g },
  { kind: 'vault-token', pattern: /\bhvs\.[A-Za-z0-9_-]{24,}/g },
  { kind: 'fly-token', pattern: /\bFlyV1 fm\d_[A-Za-z0-9_+/=-]{20,}/g },
  { kind: 'telegram-token', pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
  { kind: 'age-key', pattern: /\bAGE-SECRET-KEY-1[0-9A-Z]{58}\b/g },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: 'bearer-token',
    pattern:
      /(\b(?:authorization|proxy-authorization)["']?\s*[:=]\s*["']?(?:bearer|basic|token)\s+)([A-Za-z0-9._~+/-]{8,}=*)/gi,
    hasContext: true,
  },
  {
    kind: 'bearer-token',
    pattern: /(\bBearer\s+)([A-Za-z0-9._~+/-]{20,}=*)/g,
    hasContext: true,
  },
  {
    kind: 'url-credentials',
    pattern: /(\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@"'`]+:)([^\s@"'`/]+)(@)/gi,
    hasContext: true,
    validate: (secret) => !/^(?:\[REDACTED|\$|\*+$|<)/.test(secret),
  },
  {
    kind: 'secret-assignment',
    pattern: new RegExp(
      `(\\b${SECRET_NAME}["']?\\s*[:=]\\s*["']?)([^\\s"'\`,;{}()<>[\\]\\\\]{8,})(?=$|[\\s"'\`,;)}\\]\\\\])`,
      'gi',
    ),
    hasContext: true,
    // An unquoted bare word is usually code (`tokens: TokenUsage`), not a secret.
    validate: (secret, before) =>
      isPlausibleSecretValue(secret) &&
      (/["']$/.test(before) || /\d/.test(secret) || !/^[A-Za-z_$][\w$.]*$/.test(secret)),
  },
];

/**
 * KEY=value lines, as printed by `cat .env` or the Read tool (which prefixes
 * line numbers). Only applied to output already known to come from a secrets file.
 */
export const DOTENV_LINE =
  /^([ \t]*(?:\d+[\t→│|:][ \t]*)?(?:export[ \t]+)?[A-Za-z_][A-Za-z0-9_.-]*[ \t]*[=:][ \t]*)(\S.*)$/gm;

export const NETRC_PASSWORD = /(\bpassword[ \t]+)(\S+)/g;

const SECRETS_FILE_NAME = String.raw`(?:\.env(?:\.(?!example\b|sample\b|template\b|dist\b|defaults?\b)[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(?:\.json)?|secrets?\.(?:ya?ml|json|toml|env))`;

/** A path to a file whose contents are secrets wholesale. Examples and templates are not. */
export const SECRETS_PATH = new RegExp(String.raw`^(?:.*[/\\])?${SECRETS_FILE_NAME}$`);

/** One shell command that prints a secrets file, e.g. `cat .env` or `grep KEY .env.local`. */
export const SECRETS_READ_SEGMENT = new RegExp(
  String.raw`^(?:sudo\s+)?(?:cat|bat|batcat|less|more|head|tail|nl|tac|grep|egrep|fgrep|rg|ag|awk|sed|cut|sort|strings|xxd|od|base64|source|\.)(?=\s)[^|;&\n]*?[\s"'=/<]${SECRETS_FILE_NAME}(?=$|[\s"'|;&<>)])`,
);

/** A single shell command that dumps the whole environment as KEY=value lines. */
export const ENV_DUMP_SEGMENT = /^(?:sudo\s+)?(?:printenv|env|export\s+-p|declare\s+-x|set)$/;
