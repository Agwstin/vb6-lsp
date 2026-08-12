import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(args.root || process.env.VB6_BENCH_ROOT || process.cwd());
const requestedSourceDirs = (args.sourceDirs || process.env.VB6_BENCH_SOURCE_DIRS || '')
  .split(/[;\n]/)
  .map((value) => value.trim())
  .filter(Boolean);
const sourceDirs = requestedSourceDirs.length > 0
  ? requestedSourceDirs.map((value) => path.resolve(rootDir, value))
  : discoverDefaultSourceDirs(rootDir);
const iterations = Math.max(3, Math.min(Number(args.iterations || 25), 200));

if (sourceDirs.length === 0) {
  throw new Error(`No VB6 source directories found under ${rootDir}. Pass --source-dirs or VB6_BENCH_SOURCE_DIRS.`);
}

const {
  VB6Indexer,
} = require(path.resolve('out/server/indexer/indexer.js'));
const { handleCompletion } = require(path.resolve('out/server/providers/completion.js'));
const { handleDefinition } = require(path.resolve('out/server/providers/definition.js'));
const { handleReferences } = require(path.resolve('out/server/providers/references.js'));
const { findReferences } = require(path.resolve('out/server/indexer/mcp-bridge.js'));
const { TextDocument } = require('vscode-languageserver-textdocument');

let peakRss = process.memoryUsage().rss;
const coldIndex = measureRuns(
  'index_cold',
  () => {
    const indexer = new VB6Indexer(rootDir, sourceDirs);
    const symbolCount = indexer.buildFullIndex();
    return { files: indexer.getIndex().files.size, symbolCount };
  },
  3,
  (value) => value.symbolCount,
);

const warmIndexer = new VB6Indexer(rootDir, sourceDirs);
warmIndexer.buildFullIndex();
const warmIndex = measureRuns(
  'index_warm',
  () => {
    const symbolCount = warmIndexer.buildFullIndex();
    return { files: warmIndexer.getIndex().files.size, symbolCount };
  },
  3,
  (value) => value.symbolCount,
);

const index = warmIndexer.getIndex();
const target = pickTarget(index);
if (!target) throw new Error('No public routine symbol was found in the selected workspace.');

const document = createDocument(target.file);
const documents = { get: (uri) => (uri === document.uri ? document : undefined) };
const position = positionForSymbol(document, target);
const request = { textDocument: { uri: document.uri }, position };

const definition = measureRuns(
  'lsp_definition',
  () => handleDefinition(request, documents, index),
  iterations,
);
const references = measureRuns(
  'lsp_references',
  () => handleReferences({ ...request, context: { includeDeclaration: false } }, documents, index),
  iterations,
);
const completion = measureRuns(
  'lsp_completion',
  () => handleCompletion(request, documents, index),
  iterations,
);

const mcpIndex = toMcpIndex(rootDir, index);
const mcpReferences = measureRuns(
  'mcp_find_references',
  () => findReferences(mcpIndex, target.name, 200),
  iterations,
);

const result = {
  rootDir,
  sourceDirs,
  files: index.files.size,
  symbols: Array.from(index.byFile.values()).reduce((total, symbols) => total + symbols.length, 0),
  target: {
    name: target.name,
    kind: target.kind,
    file: target.file,
    line: target.line,
  },
  iterations,
  benchmarks: [coldIndex, warmIndex, definition, references, completion, mcpReferences],
  peak_rss_mb: round(peakRss / 1024 / 1024),
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function measureRuns(name, fn, count = iterations, countFn = countValue) {
  const durations = [];
  let result;
  for (let index = 0; index < count; index++) {
    const started = performance.now();
    result = fn();
    durations.push(performance.now() - started);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }

  const sorted = [...durations].sort((left, right) => left - right);
  return {
    name,
    iterations: count,
    p50_ms: round(percentile(sorted, 0.5)),
    p95_ms: round(percentile(sorted, 0.95)),
    min_ms: round(sorted[0]),
    max_ms: round(sorted[sorted.length - 1]),
    result_count: countFn(result),
  };
}

function countValue(value) {
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') {
    if (Array.isArray(value.data)) return value.data.length;
    if (Array.isArray(value.items)) return value.items.length;
    if (Array.isArray(value.results)) return value.results.length;
  }
  return null;
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * fraction) - 1));
  return values[index];
}

function round(value) {
  return Number(value.toFixed(3));
}

function pickTarget(index) {
  for (const symbols of index.byFile.values()) {
    const target = symbols.find((symbol) =>
      symbol.scope === 'module' &&
      symbol.visibility === 'Public' &&
      ['Sub', 'Function', 'Property', 'Declare'].includes(symbol.kind) &&
      symbol.name.length >= 3,
    );
    if (target) return target;
  }
  return null;
}

function createDocument(filePath) {
  const uri = pathToFileURL(filePath).href;
  return TextDocument.create(uri, 'vb6', 1, fs.readFileSync(filePath, 'latin1'));
}

function positionForSymbol(document, symbol) {
  const lines = document.getText().split(/\r?\n/);
  const lineIndex = Math.max(0, symbol.line - 1);
  const character = Math.max(0, (lines[lineIndex] || '').toLowerCase().indexOf(symbol.name.toLowerCase()));
  return { line: lineIndex, character: character + 1 };
}

function toMcpIndex(root, index) {
  const symbols = [];
  const byName = new Map();
  const byFile = new Map();
  const fileContents = new Map();
  const files = [];

  for (const [normalizedPath, fileSymbols] of index.byFile) {
    const absolutePath = fileSymbols[0]?.file || normalizedPath;
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
    const contents = readLines(absolutePath);
    fileContents.set(relativePath, contents);

    const mcpSymbols = fileSymbols.map((symbol) => ({
      ...symbol,
      file: relativePath,
      signature: symbol.signature.slice(0, 300),
      returnType: symbol.returnType || '',
    }));
    symbols.push(...mcpSymbols);
    byFile.set(relativePath, mcpSymbols);
    files.push({ name: path.basename(absolutePath), dir: path.dirname(relativePath), path: absolutePath });
  }

  for (const symbol of symbols) {
    const key = symbol.name.toLowerCase();
    const bucket = byName.get(key) || [];
    bucket.push(symbol);
    byName.set(key, bucket);
  }

  return { symbols, byName, byFile, fileContents, files };
}

function readLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'latin1').split(/\r?\n/);
  } catch {
    return [];
  }
}

function discoverDefaultSourceDirs(root) {
  const results = [];
  const visit = (dir, depth = 0) => {
    if (depth > 3) return;
    let children;
    try {
      children = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (children.some((child) => child.isFile() && /\.(bas|cls|frm|ctl)$/i.test(child.name))) {
      results.push(dir);
    }
    for (const child of children) {
      if (!child.isDirectory() || ['.git', 'node_modules', 'out'].includes(child.name)) continue;
      visit(path.join(dir, child.name), depth + 1);
    }
  };
  visit(root);
  return [...new Set(results)];
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--root') parsed.root = argv[++index];
    else if (item === '--source-dirs') parsed.sourceDirs = argv[++index];
    else if (item === '--iterations') parsed.iterations = argv[++index];
  }
  return parsed;
}
