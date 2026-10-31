import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditFiles, listFiles, runtimeDependencyDirs } from '../support/network-audit.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Adding a runtime dependency means auditing it and listing it here. The
// audit below then scans its code and everything it pulls in.
const REVIEWED_RUNTIME_DEPENDENCIES: readonly string[] = ['@resvg/resvg-wasm'];

// A single, reviewed exception. @resvg/resvg-wasm's loader contains a `fetch`
// used only when you ask it to load the wasm from a URL (index.mjs line ~538:
// `input = fetch(input)`, reached only when `input` is a string/URL/Request).
// nocap always passes the wasm bytes read from the local file, so that branch
// is never taken. The runtime proof in png-offline.test.ts renders a PNG under
// the network tripwire to confirm no connection is made. Everything else in the
// dependency is still audited strictly, including any network module.
const REVIEWED_EXCEPTIONS: readonly string[] = [
  '@resvg/resvg-wasm/index.js:',
  '@resvg/resvg-wasm/index.mjs:',
  '@resvg/resvg-wasm/index.min.js:',
];

function withoutReviewed(findings: readonly string[]): string[] {
  return findings.filter(
    (f) => !(f.includes('network-global: fetch') && REVIEWED_EXCEPTIONS.some((e) => f.includes(e))),
  );
}

describe('shipped code cannot reach the network', () => {
  it('nocap source', () => {
    const files = listFiles(join(root, 'src'), ['.ts']);
    expect(files.length).toBeGreaterThan(0);
    expect(auditFiles(files, root)).toEqual([]);
  });

  it('built output', () => {
    const files = listFiles(join(root, 'dist'), ['.js', '.mjs', '.cjs']);
    expect(files.length).toBeGreaterThan(0);
    expect(auditFiles(files, root)).toEqual([]);
  });

  it('runtime dependencies are reviewed', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).sort();
    expect(declared).toEqual([...REVIEWED_RUNTIME_DEPENDENCIES].sort());
  });

  it('runtime dependencies and their transitive dependencies', () => {
    const files = runtimeDependencyDirs(root).flatMap((dir) =>
      listFiles(dir, ['.js', '.mjs', '.cjs']),
    );
    expect(withoutReviewed(auditFiles(files, root))).toEqual([]);
  });

  it('the only allowed dependency finding is the reviewed wasm-loader fetch', () => {
    const files = runtimeDependencyDirs(root).flatMap((dir) =>
      listFiles(dir, ['.js', '.mjs', '.cjs']),
    );
    const allowed = auditFiles(files, root).filter((f) => !withoutReviewed([f]).length);
    // Every allowed finding must be the resvg-wasm fetch and nothing else.
    for (const f of allowed) {
      expect(f).toContain('network-global: fetch');
      expect(REVIEWED_EXCEPTIONS.some((e) => f.includes(e))).toBe(true);
    }
  });
});
