#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import { cruise } from 'dependency-cruiser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(projectRoot, 'src');

const args = process.argv.slice(2);
const wantsStdout = args.includes('--stdout');
const targetPathArg = args.find((arg) => !arg.startsWith('--'));
const defaultOutput = path.join(projectRoot, 'docs', 'architecture-map.md');
const outputPath = targetPathArg ? path.resolve(projectRoot, targetPathArg) : defaultOutput;

function relFromProject(filePath) {
  return path.relative(projectRoot, filePath).replace(/\\/g, '/');
}

function deriveGroup(relPath) {
  if (!relPath.startsWith('src/')) {
    return null;
  }
  const withoutSrc = relPath.slice('src/'.length);
  const segments = withoutSrc.split('/');
  if (segments.length === 1) {
    return 'src';
  }
  if (segments[0] === 'js') {
    if (segments.length === 2) {
      return `js/${segments[1]}`;
    }
    return `js/${segments[1]}`;
  }
  return segments[0];
}

function toMermaidId(groupName) {
  return `G_${groupName.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function toDisplayName(groupName) {
  const mappings = new Map([
    ['src', 'Entry & Root'],
    ['js/core', 'Core'],
    ['js/ui', 'UI'],
    ['js/utils', 'Utilities'],
    ['js/data', 'Data'],
    ['js/theme', 'Theme'],
  ]);
  if (mappings.has(groupName)) {
    return mappings.get(groupName);
  }
  const tokens = groupName.split('/').filter(Boolean);
  const suffix = tokens[tokens.length - 1] || groupName;
  return suffix.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildMermaid(groupsMap, edgeMap) {
  const sortedGroups = Array.from(groupsMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  const lines = ['```mermaid', 'flowchart TD'];
  sortedGroups.forEach(([groupName, data]) => {
    const nodeId = toMermaidId(groupName);
    const display = `${toDisplayName(groupName)}\\n(${data.modules.size} modules)`;
    lines.push(`  ${nodeId}["${display.replace(/"/g, '\"')}"]`);
  });

  const sortedEdges = Array.from(edgeMap.entries()).sort(([a], [b]) => a.localeCompare(b));
  sortedEdges.forEach(([key, count]) => {
    const [from, to] = key.split('::');
    if (!groupsMap.has(from) || !groupsMap.has(to) || from === to) {
      return;
    }
    const fromId = toMermaidId(from);
    const toId = toMermaidId(to);
    lines.push(`  ${fromId} -->|${count}| ${toId}`);
  });

  lines.push('```');
  return lines.join('\n');
}

async function run() {
  const cruiseResult = await cruise(
    [srcRoot],
    {
      exclude: 'node_modules|tests|docs|dist',
      includeOnly: '^src',
      combinedDependencies: true,
      doNotFollow: 'node_modules',
      tsPreCompilationDeps: false,
    },
    { outputType: 'json' }
  );

  if (!cruiseResult.output) {
    throw new Error('dependency-cruiser returned no output');
  }

  const output = cruiseResult.output;
  const groupsMap = new Map();
  const edgeMap = new Map();

  output.modules
    .filter((module) => module.source)
    .forEach((module) => {
      const relSource = relFromProject(module.source);
      if (!relSource.match(/\.(js|mjs|ts)$/)) {
        return;
      }
      const group = deriveGroup(relSource);
      if (!group) {
        return;
      }
      if (!groupsMap.has(group)) {
        groupsMap.set(group, { modules: new Set(), samples: [] });
      }
      const groupInfo = groupsMap.get(group);
      groupInfo.modules.add(relSource);
      if (groupInfo.samples.length < 5) {
        groupInfo.samples.push(relSource);
      }

      module.dependencies.forEach((dep) => {
        if (!dep.resolved) {
          return;
        }
        const relDep = relFromProject(dep.resolved);
        if (!relDep.startsWith('src/') || !relDep.match(/\.(js|mjs|ts)$/)) {
          return;
        }
        const depGroup = deriveGroup(relDep);
        if (!depGroup || depGroup === group) {
          return;
        }
        const edgeKey = `${group}::${depGroup}`;
        edgeMap.set(edgeKey, (edgeMap.get(edgeKey) || 0) + 1);
      });
    });

  if (groupsMap.size === 0) {
    throw new Error('No modules found under src/. Check that the source tree exists.');
  }

  const now = new Date();
  const mermaidDiagram = buildMermaid(groupsMap, edgeMap);
  const lines = [
    '# quadGEN Architecture Map',
    '',
    `Generated on ${now.toISOString()}`,
    '',
    'This diagram groups source modules by their primary directory and highlights cross-cluster dependencies.',
    '',
    mermaidDiagram,
    '',
    '## Directory Samples',
  ];

  Array.from(groupsMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([groupName, info]) => {
      lines.push(`- **${toDisplayName(groupName)}** (${info.modules.size} modules)`);
      info.samples.forEach((sample) => {
        lines.push(`  - ${sample}`);
      });
    });

  const markdown = `${lines.join('\n')}\n`;

  if (wantsStdout) {
    process.stdout.write(markdown);
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown, 'utf8');
  process.stdout.write(`Architecture map written to ${relFromProject(outputPath)}\n`);
}

run().catch((error) => {
  process.stderr.write(`Failed to export architecture map: ${error.message}\n`);
  process.exitCode = 1;
});
