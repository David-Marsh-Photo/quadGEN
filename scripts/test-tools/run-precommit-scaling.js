#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const skipFlag = process.env.SKIP_SCALING_PRECHECK;
if (skipFlag && skipFlag.toLowerCase() !== 'false' && skipFlag !== '0') {
  console.log('[pre-commit] SKIP_SCALING_PRECHECK detected, skipping scaling baseline tests.');
  process.exit(0);
}

console.log('[pre-commit] Running scaling baseline guard (tests/core/scaling-utils-baseline.test.js)...');
const result = spawnSync('npm', ['run', '--silent', 'test:scaling:baseline'], {
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  console.error('[pre-commit] Scaling baseline tests failed. Commit aborted.');
}

process.exit(result.status ?? 1);
