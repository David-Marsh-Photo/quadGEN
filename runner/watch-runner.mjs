console.log('watch-runner is running');
// runner/watch-runner.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'path';

const TRIGGER = path.resolve('runner/trigger.json');
const OUTDIR  = path.resolve('runner/results');
fs.mkdirSync(OUTDIR, { recursive: true });

const queue = [];
let running = false;

function sanitizeEnv(env) {
  if (!env || typeof env !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key) continue;
    result[key] = String(value);
  }
  return result;
}

function processQueue() {
  if (running || queue.length === 0) return;

  const { args, env } = queue.shift();
  running = true;

  const started = new Date().toISOString();
  const cmd = 'npm';
  const cmdArgs = ['run', 'test:e2e', '--', ...args]; // 🔑 ensures Playwright runner

  const childEnv = { ...process.env, ...env };
  const p = spawn(cmd, cmdArgs, { shell: true, env: childEnv });
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => err += d);

  p.on('close', code => {
    const finished = new Date().toISOString();
    const report = [
      `started:  ${started}`,
      `finished: ${finished}`,
      `exitCode: ${code}`,
      `env:      ${JSON.stringify(env)}`,
      `args:     ${JSON.stringify(args)}`,
      `\n--- STDOUT ---\n${out}`,
      err ? `\n--- STDERR ---\n${err}` : ''
    ].join('\n');

    fs.writeFileSync(path.join(OUTDIR, 'last-run.txt'), report);
    fs.writeFileSync(path.join(OUTDIR, 'status.json'),
      JSON.stringify({ started, finished, exitCode: code, args, env }, null, 2));

    running = false;
    processQueue();
  });
}

// watch trigger (polling so it works across Dropbox)
setInterval(() => {
  if (!fs.existsSync(TRIGGER)) return;
  const raw = fs.readFileSync(TRIGGER, 'utf8');
  if (!raw) return;
  let trig;
  try {
    trig = JSON.parse(raw);
  } catch (err) {
    console.warn('[watch-runner] Invalid trigger JSON:', err.message);
    return;
  }
  const ts = trig.ts || 0;
  if (!global._lastTs || ts > global._lastTs) {
    global._lastTs = ts;
    const args = Array.isArray(trig.args) ? trig.args : [];
    const env = sanitizeEnv(trig.env);
    queue.push({ args, env });
    processQueue();
  }
}, 1000);
