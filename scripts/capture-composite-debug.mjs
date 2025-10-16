#!/usr/bin/env node

/**
 * Capture composite redistribution debug data headlessly.
 *
 * Usage:
 *   node scripts/capture-composite-debug.mjs --quad data/TRIFORCE_V4.quad --lab data/TRIFORCE_V4.txt --mode normalized --channels K,C,LK --output analysis/baseline_density_pre.json
 *
 * Notes:
 * - Provides minimal DOM stubs so modular code can initialize safely.
 * - Defaults are tailored to LAB global redistribution diagnostics.
 */

import fs from 'fs';
import path from 'path';
import process from 'process';

function makeStubElement() {
  return {
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    appendChild() {},
    querySelector() { return makeStubElement(); },
    querySelectorAll() { return []; },
    style: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    innerHTML: '',
    value: '',
    textContent: '',
    dataset: {},
    disabled: false
  };
}

const documentStub = {
    getElementById() { return makeStubElement(); },
    querySelector() { return makeStubElement(); },
    querySelectorAll() { return []; },
    createElement() { return makeStubElement(); },
    body: makeStubElement(),
    documentElement: makeStubElement(),
    addEventListener() {},
    removeEventListener() {}
};

globalThis.document = documentStub;
globalThis.window = {
    localStorage: {
        getItem() { return null; },
        setItem() {},
        removeItem() {}
    },
    matchMedia() {
        return { matches: false, addEventListener() {}, removeEventListener() {} };
    },
    addEventListener() {},
    removeEventListener() {},
    location: { reload() {} },
    document: documentStub
};

if (process.env.DEBUG_LOGS === '1' || process.env.DEBUG_LOGS === 'true') {
    globalThis.DEBUG_LOGS = true;
}

const argMap = {};
for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true;
    argMap[key] = value;
    if (value !== true) i += 1;
}

const quadPath = argMap.quad || argMap.q;
const labPath = argMap.lab || argMap.l;
const mode = argMap.mode || 'normalized';
const channelList = (argMap.channels || argMap.ch || '').split(',').filter(Boolean);
const outputPath = argMap.output || argMap.o;

if (!quadPath || !labPath) {
    console.error('Usage: node scripts/capture-composite-debug.mjs --quad <quadFile> --lab <labFile> [--mode normalized|isolated|momentum] [--channels K,C,LK] [--output file.json]');
    process.exit(1);
}

const resolvePath = (p) => path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);

const quadFile = resolvePath(quadPath);
const labFile = resolvePath(labPath);

if (!fs.existsSync(quadFile)) {
    console.error(`Quad file not found: ${quadFile}`);
    process.exit(1);
}
if (!fs.existsSync(labFile)) {
    console.error(`LAB file not found: ${labFile}`);
    process.exit(1);
}

const quadContents = fs.readFileSync(quadFile, 'utf8');
const labContents = fs.readFileSync(labFile, 'utf8');

const TOTAL = 65535;
const curves = {};
let current = null;
quadContents.split(/\r?\n/).forEach((line) => {
    if (line.startsWith('# ')) {
        const match = line.match(/^#\s+([A-Z]{1,3}) curve/);
        current = match ? match[1] : null;
        if (current) curves[current] = [];
        return;
    }
    if (!current || !line.trim() || line.startsWith('#')) return;
    const value = Number(line.trim());
    if (!Number.isNaN(value)) {
        curves[current].push(value);
    }
});

const { parseLabData } = await import('../src/js/data/lab-parser.js');
const { beginCompositeLabRedistribution, registerCompositeLabBase, finalizeCompositeLabRedistribution } = await import('../src/js/core/processing-pipeline.js');
const { COMPOSITE_WEIGHTING_MODES, setCompositeWeightingMode } = await import('../src/js/core/composite-settings.js');
const { setCompositeDebugEnabled, getCompositeDebugState } = await import('../src/js/core/composite-debug.js');
const { getSnapshotSlopeKernelStats } = await import('../src/js/core/snapshot-slope-kernel.js');

const modeKey = Object.values(COMPOSITE_WEIGHTING_MODES).includes(mode) ? mode : COMPOSITE_WEIGHTING_MODES.NORMALIZED;
setCompositeWeightingMode(modeKey);
setCompositeDebugEnabled(true);

const labEntry = parseLabData(labContents, path.basename(labFile));
if (!labEntry || !labEntry.valid) {
    console.error(`Failed to parse LAB data: ${labFile}`);
    process.exit(1);
}

const channelNames = channelList.length ? channelList : Object.keys(curves);
const endValues = {};
channelNames.forEach((name) => {
    const curve = curves[name];
    if (!Array.isArray(curve) || !curve.length) return;
    const max = curve.reduce((acc, value) => (value > acc ? value : acc), 0);
    endValues[name] = max;
});

beginCompositeLabRedistribution({
    channelNames,
    endValues,
    labEntry,
    weightingMode: modeKey
});

channelNames.forEach((name) => {
    if (Array.isArray(curves[name])) {
        registerCompositeLabBase(name, curves[name]);
    }
});

finalizeCompositeLabRedistribution();
const state = getCompositeDebugState();

const payload = {
    mode: modeKey,
    channels: channelNames,
    summary: state.summary,
    snapshots: state.snapshots,
    kernelStats: typeof getSnapshotSlopeKernelStats === 'function'
        ? getSnapshotSlopeKernelStats()
        : null
};

const serialized = JSON.stringify(payload, null, 2);
if (outputPath) {
    const resolvedOutput = resolvePath(outputPath);
    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
    fs.writeFileSync(resolvedOutput, serialized, 'utf8');
    console.log(`Composite debug snapshot written to ${resolvedOutput}`);
} else {
    console.log(serialized);
}
