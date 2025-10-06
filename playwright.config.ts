import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  reportSlowTests: {
    max: 5,
    threshold: 15_000,
  },
  expect: {
    timeout: 5_000,
  },
  use: {
    headless: true,
  },
});
