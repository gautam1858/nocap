import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/support/build.global.ts'],
    setupFiles: ['test/support/network-tripwire.setup.ts'],
  },
});
