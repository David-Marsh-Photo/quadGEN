// run-playwright-test.js
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const script = args.length > 0 ? args[0] : 'tests/playwright-edit-mode-seeding.cjs';
const extra = args.length > 0 ? args.slice(1) : [];

const child = spawn('node', [script, ...extra], { stdio: 'inherit', shell: true });

child.on('exit', code => process.exit(code ?? 1));
