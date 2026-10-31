#!/usr/bin/env node
import './suppress-warnings.js';
import { ExitCode } from './io.js';
import { run } from './main.js';

// `nocap --help | head -1` closes the pipe early; that is not worth a stack trace.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(ExitCode.ok);
  throw error;
});

try {
  process.exitCode = await run(process.argv.slice(2), process);
} catch (error) {
  const debug = Boolean(process.env.NOCAP_DEBUG);
  const message = error instanceof Error ? error.message : String(error);
  const detail = debug && error instanceof Error ? (error.stack ?? message) : message;
  process.stderr.write(`nocap: internal error: ${detail}\n`);
  if (!debug) process.stderr.write('Re-run with NOCAP_DEBUG=1 for a stack trace.\n');
  process.exitCode = ExitCode.failure;
}
