import type { Adapter, ParsedLine, ParseResult } from '../adapters/types.js';
import { LineRedactor } from '../redact/lines.js';
import { Redactor } from '../redact/redactor.js';

export interface ProcessedFile {
  readonly lines: readonly string[];
  readonly changed: boolean;
  readonly result: ParseResult;
  readonly redactions: ReadonlyMap<string, number>;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Redacts every line, then parses the redacted values. Nothing unredacted survives this function. */
export function processText(
  adapter: Adapter,
  text: string,
  archivePath: string,
  home: string,
): ProcessedFile {
  const redactor = new Redactor({ home });
  const lineRedactor = new LineRedactor(redactor);
  const lines: string[] = [];
  const parsed: ParsedLine[] = [];
  splitLines(text).forEach((raw, index) => {
    if (raw.trim() === '') {
      lines.push(raw);
      return;
    }
    const { text: redacted, value } = lineRedactor.line(raw);
    lines.push(redacted);
    parsed.push({ line: index + 1, value });
  });
  return {
    lines,
    changed: redactor.changes > 0,
    result: adapter.parse(parsed, { file: archivePath }),
    redactions: new Map(redactor.counts),
  };
}
