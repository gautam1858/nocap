// Recognises test files across languages, so the polygraph can tell a source
// edit from a test edit, and testwash can watch the test edits.
const TEST_FILE_PATTERNS: readonly RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i, // foo.test.ts, foo.spec.jsx
  /(^|\/)test_[^/]+\.py$/i, // test_foo.py
  /_test\.py$/i, // foo_test.py
  /(^|\/)conftest\.py$/i,
  /_test\.go$/i,
  /_(test|spec)\.rb$/i,
  /(^|\/)[^/]*[Tt]ests?\.(java|kt|kts|cs|scala)$/, // FooTest.java, FooTests.cs
  /(^|\/)[^/]*[Tt]est\.php$/,
  /_test\.(exs|rs|dart|swift|zig)$/i,
  /\.(feature)$/i, // cucumber
];

const TEST_DIR = /(^|\/)(?:__tests__|tests?|specs?|e2e|integration[._-]?tests?)(\/|$)/i;

export function isTestFile(path: string): boolean {
  const normalised = path.replace(/\\/g, '/');
  if (TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalised))) return true;
  // A directory named test/spec counts only for source-code files, so a fixture
  // or data file under tests/ is not mistaken for a test.
  return (
    TEST_DIR.test(normalised) &&
    /\.[cm]?[jt]sx?$|\.py$|\.go$|\.rb$|\.rs$|\.java$|\.kt$/i.test(normalised)
  );
}
