import { afterEach, expect } from 'vitest';
import { install, takeAttempts } from './network-tripwire.mjs';

install();

afterEach(() => {
  expect(takeAttempts(), 'code under test attempted network access').toEqual([]);
});
