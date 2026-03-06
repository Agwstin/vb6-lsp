import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const bridge = await import(pathToFileURL(path.resolve('mcp-bridge.mjs')).href);
const { buildVB6Index, findReferences, searchCode } = bridge;

const args = parseArgs(process.argv.slice(2));
const rootArg = args.root || process.env.VB6_BENCH_ROOT || process.cwd();
const rootDir = path.resolve(rootArg);
const sourceDirs = (args.sourceDirs || process.env.VB6_BENCH_SOURCE_DIRS || '')
  .split(/[;\n]/)
  .map((value) => value.trim())
  .filter(Boolean);

const effectiveSourceDirs = sourceDirs.length > 0 ? sourceDirs : discoverDefaultSourceDirs(rootDir);

if (effectiveSourceDirs.length === 0) {
  throw new Error(`No VB6 source directories found under ${rootDir}. Pass --source-dirs or VB6_BENCH_SOURCE_DIRS.`);
}

const indexStart = performance.now();
const index = buildVB6Index(rootDir, effectiveSourceDirs);
const indexMs = performance.now() - indexStart;

const exactSymbol = pickExactSymbol(index);
const refSymbol = pickReferenceSymbol(index);
const scopedSearch = pickScopedSearch(index, refSymbol || exactSymbol);
const broadSearch = pickBroadSearch(index);

const results = [];

results.push({
  benchmark: 'Index startup',
  lspMs: indexMs,
  grepMs: null,
  winner: 'grep',
  notes: `${index.files.length} files, ${index.symbols.length} symbols`,
});

if (exactSymbol) {
  results.push(compare(
    'Exact symbol lookup',
    () => index.byName.get(exactSymbol.name.toLowerCase()) || [],
    () => grepWholeWord(rootDir, exactSymbol.name),
    `module symbol`,
  ));
}

if (refSymbol) {
  results.push(compare(
    'Reference search',
    () => findReferences(index, refSymbol.name, 200),
    () => grepWholeWord(rootDir, refSymbol.name),
    `common symbol`,
  ));
}

if (scopedSearch) {
  results.push(compare(
    'Scoped text search',
    () => searchCode(index, scopedSearch.query, { scope: scopedSearch.scope, maxResults: 200 }),
    () => grepScoped(rootDir, scopedSearch.query, scopedSearch.scope),
    `scope=${scopedSearch.scope}`,
  ));
}

if (broadSearch) {
  results.push(compare(
    'Unscoped text search',
    () => searchCode(index, broadSearch.query, { maxResults: 200 }),
    () => grepWholeWord(rootDir, broadSearch.query),
    `workspace-wide`,
  ));
}

const summary = {
  rootDir,
  sourceDirs: effectiveSourceDirs,
  files: index.files.length,
  symbols: index.symbols.length,
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (args.markdownOut) {
  fs.writeFileSync(path.resolve(args.markdownOut), toMarkdown(summary), 'utf8');
}

function compare(label, lspFn, grepFn, notes) {
  const lspMs = measure(lspFn);
  const grepMs = measure(grepFn);
  return {
    benchmark: label,
    lspMs,
    grepMs,
    winner: grepMs === null ? 'lsp' : lspMs < grepMs ? 'lsp' : 'grep',
    notes,
  };
}

function measure(fn, iterations = 5) {
  let total = 0;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    total += performance.now() - start;
  }
  return total / iterations;
}

function grepWholeWord(root, query) {
  return runGitGrep(root, ['-n', '-I', '-w', '-m', '200', '--', query, '--', '*.bas', '*.cls', '*.frm']);
}

function grepScoped(root, query, scope) {
  return runGitGrep(root, ['-n', '-I', '-m', '200', '--', query, '--', scope]);
}

function runGitGrep(root, args) {
  const result = spawnSync('git', ['-C', root, 'grep', ...args], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `git grep failed with status ${result.status}`);
  }
  return result.stdout;
}

function pickExactSymbol(index) {
  return index.symbols.find((symbol) =>
    (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property' || symbol.kind === 'Declare') &&
    symbol.visibility === 'Public' &&
    index.byName.get(symbol.name.toLowerCase())?.length === 1,
  );
}

function pickReferenceSymbol(index) {
  const candidates = index.symbols.filter((symbol) =>
    symbol.visibility === 'Public' &&
    (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property' || symbol.kind === 'Declare') &&
    symbol.name.length >= 5,
  ).slice(0, 200);

  let best = null;
  let bestCount = -1;
  for (const candidate of candidates) {
    const refs = findReferences(index, candidate.name, 200);
    if (refs.length > bestCount) {
      best = candidate;
      bestCount = refs.length;
    }
  }
  return best;
}

function pickScopedSearch(index, symbol) {
  if (!symbol) return null;
  const scope = symbol.file.includes('/') ? symbol.file.split('/')[0] : path.dirname(symbol.file).split(path.sep)[0];
  if (!scope) return null;
  return { query: symbol.name, scope };
}

function pickBroadSearch(index) {
  const candidate = index.symbols.find((symbol) => symbol.name.length >= 6);
  if (!candidate) return null;
  return { query: candidate.name };
}

function discoverDefaultSourceDirs(root) {
  const entries = [];
  const visit = (dir, depth = 0) => {
    if (depth > 3) return;
    let children;
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    let hasVb6Files = false;
    for (const child of children) {
      if (child.isFile() && /\.(bas|cls|frm)$/i.test(child.name)) {
        hasVb6Files = true;
        break;
      }
    }
    if (hasVb6Files) {
      entries.push(path.relative(root, dir) || '.');
    }

    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (['.git', 'node_modules', 'out'].includes(child.name)) continue;
      visit(path.join(dir, child.name), depth + 1);
    }
  };

  visit(root);
  return [...new Set(entries)];
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--root') parsed.root = argv[++i];
    else if (item === '--source-dirs') parsed.sourceDirs = argv[++i];
    else if (item === '--markdown-out') parsed.markdownOut = argv[++i];
  }
  return parsed;
}

function toMarkdown(summary) {
  const rows = summary.results.map((result) => {
    const grepCell = result.grepMs === null ? 'n/a' : `${result.grepMs.toFixed(2)} ms`;
    return `| ${result.benchmark} | ${result.lspMs.toFixed(2)} ms | ${grepCell} | ${result.winner} | ${result.notes} |`;
  }).join('\n');

  return `# Benchmark\n\n` +
    `Workspace: \`${summary.rootDir}\`\n\n` +
    `Files indexed: **${summary.files}**\n\n` +
    `Symbols indexed: **${summary.symbols}**\n\n` +
    `| Benchmark | vb6-lsp | git grep | Winner | Notes |\n` +
    `| --- | ---: | ---: | --- | --- |\n` +
    `${rows}\n`;
}
