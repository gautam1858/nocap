// Preloaded with `node --import` into CLI processes spawned by tests. Exits
// immediately so that an attempt the caller catches and ignores still fails.
import { writeSync } from 'node:fs';
import { install, TRIPWIRE_EXIT_CODE, TRIPWIRE_MARKER } from './network-tripwire.mjs';

install((message) => {
  writeSync(2, `${TRIPWIRE_MARKER}: ${message}\n`);
  process.exit(TRIPWIRE_EXIT_CODE);
});
