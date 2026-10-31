import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tests that spawn the CLI or audit shipped code need a fresh dist/. Removing
// it first keeps output from deleted sources out of the audit.
export default function setup(): void {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  rmSync(new URL('../../dist', import.meta.url), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)),
      '-p',
      'tsconfig.build.json',
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
