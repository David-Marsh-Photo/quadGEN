#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const cwd = process.cwd();
const triggerPath = path.resolve(cwd, 'runner/trigger.json');
const defaultWaitScript = path.resolve(cwd, 'runner/wait-for-status.mjs');

const triggerArgs = [];
const envOverrides = {};
const waitArgs = [];

let explicitTimeout = null;
let explicitInterval = null;
let follow = false;
let quiet = false;

const rawArgs = process.argv.slice(2);
let forward = false;

for (const token of rawArgs) {
  if (token === '--') {
    forward = true;
    continue;
  }

  if (forward) {
    triggerArgs.push(token);
    continue;
  }

  if (token === '--help' || token === '-h') {
    console.log(`Usage: node runner/trigger-and-wait.mjs [options] [-- <playwright args...>]\n\n` +
      `Options:\n` +
      `  --arg=VALUE         Append VALUE to the triggered Playwright argument list.\n` +
      `  --env=KEY=VALUE     Inject KEY=VALUE into the Playwright process environment.\n` +
      `  --timeout=MS        Override wait timeout (ms).\n` +
      `  --interval=MS       Override polling interval (ms).\n` +
      `  --follow            Stream runner/results/last-run.txt while waiting.\n` +
      `  --quiet             Suppress wait status messages.\n` +
      `  --                  Treat remaining values as raw Playwright arguments.`);
    process.exit(0);
  }

  if (token.startsWith('--arg=')) {
    triggerArgs.push(token.slice('--arg='.length));
  } else if (token.startsWith('--env=')) {
    const body = token.slice('--env='.length);
    const eq = body.indexOf('=');
    if (eq > 0) {
      const key = body.slice(0, eq);
      const value = body.slice(eq + 1);
      envOverrides[key] = value;
    }
  } else if (token.startsWith('--timeout=')) {
    explicitTimeout = token.slice('--timeout='.length);
  } else if (token.startsWith('--interval=')) {
    explicitInterval = token.slice('--interval='.length);
  } else if (token === '--follow') {
    follow = true;
  } else if (token === '--quiet') {
    quiet = true;
  } else {
    triggerArgs.push(token);
  }
}

if (explicitTimeout) {
  waitArgs.push(`--timeout=${explicitTimeout}`);
}
if (explicitInterval) {
  waitArgs.push(`--interval=${explicitInterval}`);
}
if (follow) {
  waitArgs.push('--follow');
}
if (quiet) {
  waitArgs.push('--quiet');
}

const triggerPayload = {
  ts: Date.now()
};
if (triggerArgs.length > 0) {
  triggerPayload.args = triggerArgs;
}
if (Object.keys(envOverrides).length > 0) {
  triggerPayload.env = envOverrides;
}

fs.mkdirSync(path.dirname(triggerPath), { recursive: true });
fs.writeFileSync(triggerPath, JSON.stringify(triggerPayload, null, 2));

const waitProc = spawn(process.execPath, [defaultWaitScript, ...waitArgs], {
  stdio: 'inherit'
});

waitProc.on('exit', code => {
  process.exit(code ?? 0);
});
