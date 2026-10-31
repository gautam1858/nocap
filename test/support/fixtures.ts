import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Adapter } from '../../src/adapters/types.js';
import { processText, type ProcessedFile } from '../../src/archive/process.js';
import type { EventKind, EventOf } from '../../src/core/event.js';

export const FIXTURE_HOME = '/home/dev';

export function fixturePath(relative: string): string {
  return fileURLToPath(new URL(`../../fixtures/${relative}`, import.meta.url));
}

export function readFixture(relative: string): string {
  return readFileSync(fixturePath(relative), 'utf8');
}

/** Runs a fixture through the same redact-then-parse path the archive uses. */
export function processFixture(adapter: Adapter, relative: string): ProcessedFile {
  return processText(adapter, readFixture(relative), `${adapter.id}/${relative}`, FIXTURE_HOME);
}

export function eventsOf<K extends EventKind>(processed: ProcessedFile, kind: K): EventOf<K>[] {
  return processed.result.events.filter((e): e is EventOf<K> => e.kind === kind);
}

export function snapshotJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
