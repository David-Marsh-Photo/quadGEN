// run-playwright-test.js
import { spawn } from 'node:child_process';

const DEFAULT_SEEDING_SCRIPT = 'tests/playwright-edit-mode-seeding.cjs';
const DEFAULT_SCALING_SPEC_PATTERN = 'tests/e2e/global-scale-*.spec.ts';
const DEFAULT_SCALE_WORKERS = '3';

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true, ...options });

    child.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        const error = new Error(`${command} ${args.join(' ')} exited with code ${code ?? 1}`);
        error.exitCode = code ?? 1;
        reject(error);
      }
    });

    child.on('error', err => {
      const error = new Error(`${command} ${args.join(' ')} failed to spawn: ${err.message}`);
      error.exitCode = typeof err.code === 'number' ? err.code : 1;
      reject(error);
    });
  });
}

function handleFailure(error) {
  if (error) {
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
  const exitCode = error?.exitCode ?? (typeof error?.code === 'number' ? error.code : 1);
  process.exit(exitCode);
}

const args = process.argv.slice(2);

if (args.length > 0) {
  runCommand('node', [args[0], ...args.slice(1)]).catch(handleFailure);
} else {
  (async () => {
    try {
      await runCommand('node', [DEFAULT_SEEDING_SCRIPT]);
      const scaleWorkers = (process.env.SCALE_SPEC_WORKERS ?? DEFAULT_SCALE_WORKERS).trim();
      const workerArgs = scaleWorkers.length > 0 ? [`--workers=${scaleWorkers}`] : [];
      await runCommand('npx', ['playwright', 'test', DEFAULT_SCALING_SPEC_PATTERN, ...workerArgs]);
    } catch (error) {
      handleFailure(error);
    }
  })();
}
