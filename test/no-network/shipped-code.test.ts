import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditFiles, listFiles, runtimeDependencyDirs } from '../support/network-audit.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

// Adding a runtime dependency means auditing it and listing it here. The
// audit below then scans its code and everything it pulls in.
const REVIEWED_RUNTIME_DEPENDENCIES: readonly string[] = [];

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
    expect(auditFiles(files, root)).toEqual([]);
  });
});
