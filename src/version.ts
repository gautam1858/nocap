import { readFileSync } from 'node:fs';

// Read at runtime so the version cannot drift from package.json. The relative
// path holds for both src/ and dist/, which sit one level below the root.
function readVersion(): string {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (typeof raw === 'object' && raw !== null && 'version' in raw) {
    const { version } = raw;
    if (typeof version === 'string') return version;
  }
  throw new Error('package.json has no version field');
}

export const version = readVersion();
