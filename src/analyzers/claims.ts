import type { EventOf } from '../core/event.js';

export type ClaimType = 'tests-pass' | 'done' | 'no-change';

export interface ExtractedClaim {
  readonly type: ClaimType;
  /** The sentence the claim was found in, trimmed. */
  readonly sentence: string;
  /** For tests-pass: a test count if one was stated ("all 42 tests pass"). */
  readonly count?: number;
  /** For no-change: the thing the agent said it left alone. */
  readonly target?: string;
}

// Fenced code blocks and inline code are examples, not assertions about this run.
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
}

// Splits prose into sentences on ., !, ?, newlines and list markers, keeping
// enough that a claim and its qualifier ("tests pass, except the flaky one")
// stay together.
function sentences(text: string): string[] {
  return stripCode(text)
    .split(/(?<=[.!?])\s+|\n+|(?:^|\s)[-*•]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Spans wrapped in straight or smart quotes: the agent is quoting a phrase
// ("Show HN: all tests pass"), not asserting it about this session.
function quotedSpans(sentence: string): [number, number][] {
  const spans: [number, number][] = [];
  const pattern = /(["'“”‘’])(.*?)\1/g;
  for (let m = pattern.exec(sentence); m; m = pattern.exec(sentence)) {
    spans.push([m.index, m.index + m[0].length]);
  }
  return spans;
}

function matchQuoted(
  pattern: RegExp,
  sentence: string,
  spans: readonly [number, number][],
): boolean {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const scan = new RegExp(pattern.source, flags);
  for (let m = scan.exec(sentence); m; m = scan.exec(sentence)) {
    const start = m.index;
    const end = start + m[0].length;
    if (!spans.some(([a, b]) => start >= a && end <= b)) return true;
  }
  return false;
}

// A sentence is not a present-tense assertion when it is hypothetical, future,
// an intention, an instruction, or a question.
// "after"/"before" are left out on purpose: "the suite is green after the fix"
// is a present-tense claim, not a future one. The conditional words below are.
const NOT_AN_ASSERTION =
  /\b(?:should|shall|will|would|could|might|going to|gonna|once|until|if|when(?:ever)?|unless|to (?:make|ensure|get|see|verify|confirm|check)|make sure|let'?s|let me|i'?ll|i will|need to|needs to|have to|has to|try(?:ing)? to|attempt|hope|hopefully|want to|plan to|expect(?:ing)? to|in order to|so that|next|then i|about to)\b/i;

const NEGATED =
  /\b(?:not|n't|never|almost|nearly|fail(?:s|ed|ing|ure)?|broke|broken|error(?:s|ed)?|red|cannot|can't|couldn't|wasn't|weren't|isn't|aren't|don't|doesn't|didn't|won't|still (?:failing|broken)|some (?:tests? )?fail)\b/i;

/** True when the sentence is a real, present-tense, non-negated assertion. */
function isAssertion(sentence: string): boolean {
  if (sentence.includes('?')) return false;
  if (NOT_AN_ASSERTION.test(sentence)) return false;
  return true;
}

const TESTS_PASS: readonly RegExp[] = [
  /\b(?:all|the|these|those|every|both)?\s*(?:unit |integration |e2e |remaining )?tests?(?:\s+suite)?\s+(?:are\s+|is\s+|now\s+|all\s+)?(?:pass(?:ing|es|ed)?|green|succeed(?:ing|ed)?)\b/i,
  /\b(?:the\s+)?(?:test\s+)?suite\s+(?:is\s+|now\s+)?(?:pass(?:ing|es|ed)?|green)\b/i,
  /\beverything\s+(?:is\s+)?(?:pass(?:ing|es)?|green|work(?:s|ing))\b/i,
  /\b(?:all\s+)?(?:tests?\s+)?green\b/i,
  /\ball\s+(?:\d+\s+)?(?:tests?|specs?|checks?)\s+(?:now\s+)?pass/i,
  /\b\d+\s*\/\s*\d+\s+(?:tests?\s+)?(?:pass(?:ing|ed|es)?|green)\b/i,
  /\b\d+\s+(?:tests?|specs?)\s+(?:now\s+)?(?:pass(?:ed|ing|es)?)\b/i,
];

// "all 42 tests pass", "42/42 passing", "17 tests passed"
const TEST_COUNT: readonly RegExp[] = [
  /\ball\s+(\d+)\s+tests?\b/i,
  /\b(\d+)\s*\/\s*\d+\s+(?:tests?\s+)?pass/i,
  /\b(\d+)\s+(?:tests?|specs?)\s+(?:now\s+)?(?:pass(?:ed|ing|es)?)\b/i,
];

const DONE =
  /\b(?:all done|done|complete[d]?|finished|resolved|(?:it|that|this|everything)\s+(?:works?|is working)\s+now|working now|good to go|ready to (?:go|merge|ship|review)|fix(?:ed|es)?|patched)\b/i;

// The target may be a filename, so dots are allowed; cleanTarget strips a
// trailing sentence period.
const NO_CHANGE: readonly RegExp[] = [
  /\b(?:didn't|did not|haven't|have not|never|without ever)\s+(?:touch(?:ed|ing)?|modif(?:y|ied|ying)|chang(?:e|ed|ing)|edit(?:ed|ing)?|alter(?:ed|ing)?)\s+(?:the\s+|any\s+|your\s+)?([^,;:!?]+)/i,
  /\bwithout\s+(?:touch(?:ing)?|modify(?:ing)?|chang(?:ing)?|edit(?:ing)?|alter(?:ing)?)\s+(?:the\s+|any\s+)?([^,;:!?]+)/i,
  /\bleft\s+(?:the\s+|your\s+)?([^,;:!?]+?)\s+(?:untouched|unchanged|as[-\s]is|intact|alone)\b/i,
  /\bno\s+changes?\s+(?:were\s+)?(?:made\s+)?to\s+(?:the\s+|any\s+)?([^,;:!?]+)/i,
];

function cleanTarget(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.`'"]+$/, '')
    .trim();
}

export function extractClaims(claim: EventOf<'claim'>): ExtractedClaim[] {
  const found: ExtractedClaim[] = [];
  const seen = new Set<string>();
  const add = (c: ExtractedClaim): void => {
    const key = `${c.type}:${c.sentence}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(c);
  };

  for (const sentence of sentences(claim.payload.text)) {
    if (!isAssertion(sentence)) continue;
    const quoted = quotedSpans(sentence);

    const isTestsPass =
      !NEGATED.test(sentence) && TESTS_PASS.some((p) => matchQuoted(p, sentence, quoted));
    if (isTestsPass) {
      let count: number | undefined;
      for (const p of TEST_COUNT) {
        const m = p.exec(sentence);
        if (m) {
          count = Number(m[1]);
          break;
        }
      }
      add({ type: 'tests-pass', sentence, ...(count !== undefined ? { count } : {}) });
    }

    for (const p of NO_CHANGE) {
      const scan = new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`);
      const m = scan.exec(sentence);
      if (m?.[1] && !quoted.some(([a, b]) => m.index >= a && m.index < b)) {
        add({ type: 'no-change', sentence, target: cleanTarget(m[1]) });
        break;
      }
    }

    // "done"/"fixed" only when not already a more specific test claim, to avoid
    // double-counting "fixed it, tests pass" as two findings for one thought.
    if (!NEGATED.test(sentence) && !isTestsPass && matchQuoted(DONE, sentence, quoted)) {
      add({ type: 'done', sentence });
    }
  }
  return found;
}
