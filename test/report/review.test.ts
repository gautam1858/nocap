import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff, renderReviewMarkdown, reviewDiff } from '../../src/report/review.js';

const skipDiff = `diff --git a/src/billing.test.ts b/src/billing.test.ts
index 111..222 100644
--- a/src/billing.test.ts
+++ b/src/billing.test.ts
@@ -10,7 +10,7 @@
-  it('rounds half up', () => {
+  it.skip('rounds half up', () => {
     expect(round(2.5)).toBe(3);
-    expect(round(3.5)).toBe(4);
   });
diff --git a/src/app.ts b/src/app.ts
index 333..444 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1 @@
-const x = 1;
+const x = 2;
`;

const deleteDiff = `diff --git a/tests/flaky_test.py b/tests/flaky_test.py
deleted file mode 100644
index 555..000
--- a/tests/flaky_test.py
+++ /dev/null
@@ -1,3 +0,0 @@
-def test_flaky():
-    assert do() == 1
`;

const cleanDiff = `diff --git a/src/a.test.ts b/src/a.test.ts
index 1..2 100644
--- a/src/a.test.ts
+++ b/src/a.test.ts
@@ -1 +1,2 @@
 it('works', () => {
+  expect(fixed()).toBe(true);
 });
`;

describe('parseUnifiedDiff', () => {
  it('separates added and removed lines per file', () => {
    const files = parseUnifiedDiff(skipDiff);
    expect(files.map((f) => f.path)).toEqual(['src/billing.test.ts', 'src/app.ts']);
    expect(files[0]?.added).toContain("  it.skip('rounds half up', () => {");
    expect(files[0]?.removed).toContain('    expect(round(3.5)).toBe(4);');
  });

  it('records a deleted file', () => {
    const [file] = parseUnifiedDiff(deleteDiff);
    expect(file?.path).toBe('tests/flaky_test.py');
    expect(file?.op).toBe('delete');
  });
});

describe('reviewDiff', () => {
  it('flags a skip and a removed assertion, and ignores the non-test file', () => {
    const review = reviewDiff(skipDiff);
    expect(review.filesChanged).toBe(2);
    expect(review.testFilesChanged).toBe(1);
    expect(review.findings.map((f) => f.kind).sort()).toEqual([
      'assertions-removed',
      'test-skipped',
    ]);
  });

  it('flags a deleted test file', () => {
    expect(reviewDiff(deleteDiff).findings.map((f) => f.kind)).toEqual(['test-file-deleted']);
  });

  it('says nothing is wrong when a test only gains an assertion', () => {
    const review = reviewDiff(cleanDiff);
    expect(review.findings).toEqual([]);
    expect(review.testFilesChanged).toBe(1);
  });

  it('handles an empty diff', () => {
    expect(reviewDiff('')).toEqual({ filesChanged: 0, testFilesChanged: 0, findings: [] });
  });
});

describe('renderReviewMarkdown', () => {
  it('renders a findings table', () => {
    const md = renderReviewMarkdown(reviewDiff(skipDiff));
    expect(md).toContain('### 🪪 nocap review');
    expect(md).toContain('test skipped');
    expect(md).toContain('`src/billing.test.ts`');
    expect(md).toContain('not a merge blocker');
  });

  it('renders the clean case', () => {
    const md = renderReviewMarkdown(reviewDiff(cleanDiff));
    expect(md).toContain('✅ No tests were skipped');
  });

  it('escapes pipes so the table never breaks', () => {
    const diff = `diff --git a/x.test.ts b/x.test.ts\n--- a/x.test.ts\n+++ b/x.test.ts\n@@ -1 +1 @@\n-it('a | b', () => { expect(1).toBe(1); expect(2).toBe(2); })\n+it.skip('a | b', () => {})\n`;
    expect(renderReviewMarkdown(reviewDiff(diff))).not.toMatch(/\|\s*b'.*\|.*\|.*\|.*\|/);
  });
});
