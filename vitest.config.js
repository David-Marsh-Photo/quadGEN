
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Look for test files in the 'tests' directory
    include: ['tests/**/*.{test,spec}.js'],
    setupFiles: ['tests/setup/vitest-env-shim.js'],
  },
});
