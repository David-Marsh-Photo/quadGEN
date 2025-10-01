#!/usr/bin/env node
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

const cwd = process.cwd();
const statusPath = path.resolve(cwd, 'runner/results/status.json');
const triggerPath = path.resolve(cwd, 'runner/trigger.json');

const LOGFILE = path.resolve(cwd, 'runner/results/last-run.txt');

const defaults = {
  timeout: 180000,
  interval: 1000,
  quiet: false,
  follow: false
};

const options = { ...defaults };
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--timeout=')) {
    const value = Number(arg.split('=')[1]);
    if (Number.isFinite(value) && value > 0) options.timeout = value;
  } else if (arg.startsWith('--interval=')) {
    const value = Number(arg.split('=')[1]);
    if (Number.isFinite(value) && value > 0) options.interval = value;
  } else if (arg === '--quiet') {
    options.quiet = true;
  } else if (arg === '--follow') {
    options.follow = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(`Usage: node runner/wait-for-status.mjs [--timeout=ms] [--interval=ms] [--quiet]\n` +
      `              [--follow]\n` +
      `Waits for runner/results/status.json to reflect the latest trigger.\n` +
      `--follow streams runner/results/last-run.txt as it grows.`);
    process.exit(0);
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function loadJSON(file) {
  try {
    const data = await fsp.readFile(file, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

function toMs(value) {
  if (!value) return NaN;
  if (typeof value === 'number') return value;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

(async () => {
  if (!fs.existsSync(triggerPath)) {
    console.error('No trigger.json found at', triggerPath);
    process.exit(1);
  }

  const trigger = await loadJSON(triggerPath);
  const triggerTs = toMs(trigger?.ts) || Date.now();
  const startTime = Date.now();
  const endTime = startTime + options.timeout;
  let lastLogSize = 0;

  if (options.follow) {
    try {
      const stat = await fsp.stat(LOGFILE);
      lastLogSize = stat.size;
    } catch (_) {
      lastLogSize = 0;
    }
  }

  if (!options.quiet) {
    console.log(`⏳ Waiting for Playwright run (timeout ${options.timeout} ms)...`);
  }

  let lastMessage = startTime;
  while (Date.now() < endTime) {
    const status = await loadJSON(statusPath);
    if (status) {
      const started = toMs(status.started);
      const finished = toMs(status.finished);
      if (Number.isFinite(started) && Number.isFinite(finished) && finished >= started) {
        if (started >= triggerTs || finished >= triggerTs) {
          const duration = finished - started;
          if (!options.quiet) {
            console.log(`✅ Runner finished (exitCode ${status.exitCode ?? 'unknown'}) in ${Number.isFinite(duration) ? `${duration} ms` : 'n/a'}`);
          }
          process.exit(status.exitCode ?? 0);
        }
      }
    }

    if (options.follow) {
      try {
        const stat = await fsp.stat(LOGFILE);
        if (stat.size > lastLogSize) {
          const handle = await fsp.open(LOGFILE, 'r');
          const buffer = Buffer.alloc(stat.size - lastLogSize);
          await handle.read(buffer, 0, buffer.length, lastLogSize);
          await handle.close();
          process.stdout.write(buffer.toString());
          lastLogSize = stat.size;
        }
      } catch (_) {
        // ignore missing file while test is running
      }
    }

    if (!options.quiet && Date.now() - lastMessage >= 5000) {
      const elapsed = Date.now() - startTime;
      console.log(`…still waiting (${elapsed} ms elapsed)`);
      lastMessage = Date.now();
    }

    await sleep(options.interval);
  }

  console.error(`❌ Timed out after ${options.timeout} ms waiting for runner/results/status.json`);
  process.exit(1);
})();
