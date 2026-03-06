import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('tests');
const files = collectTestFiles(root);

if (files.length === 0) {
  console.error('No test files found under tests/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  windowsHide: true,
});

process.exit(result.status ?? 1);

function collectTestFiles(dir) {
  const results = [];
  visit(dir, results);
  return results.sort();
}

function visit(dir, results) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visit(fullPath, results);
      continue;
    }
    if (/\.test\.js$/i.test(entry.name)) {
      results.push(fullPath);
    }
  }
}
