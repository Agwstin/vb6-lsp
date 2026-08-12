// Agent-rescue benchmark: replays the exact failure shapes observed in real
// MCP telemetry (ambiguous filenames, Module.Proc names, arg aliases, scoped
// searches with backslashes/bogus scopes, out-of-order token queries) through
// the live MCP server and measures how many now succeed.
//
// Usage:
//   node scripts/benchmark-rescue.mjs [--root <workspace>] [--source-dirs "A;B"]
// Defaults to VB6_BENCH_ROOT / VB6_LSP_ROOT, falling back to tests/fixtures.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const bridge = await import(pathToFileURL(path.resolve('mcp-bridge.mjs')).href);
const { buildVB6Index } = bridge;

const args = parseArgs(process.argv.slice(2));
const rootDir = path.resolve(args.root || process.env.VB6_BENCH_ROOT || process.env.VB6_LSP_ROOT || path.resolve('tests', 'fixtures', 'sample-workspace'));
const sourceDirsRaw = args.sourceDirs || process.env.VB6_BENCH_SOURCE_DIRS || process.env.VB6_LSP_SOURCE_DIRS || '';
const sourceDirs = sourceDirsRaw.split(/[;\n]/).map((value) => value.trim()).filter(Boolean);

if (!fs.existsSync(rootDir)) {
  console.error(`Workspace not found: ${rootDir}`);
  process.exit(2);
}

// ── Build the index in-process to DISCOVER scenarios (the server runs its own copy) ──
const index = buildVB6Index(rootDir, sourceDirs.length > 0 ? sourceDirs : ['.']);
const routineKinds = new Set(['Sub', 'Function', 'Property', 'Declare']);
const routines = index.symbols.filter((s) => s.scope === 'module' && routineKinds.has(s.kind));

const preferDirs = sourceDirs.map((dir) => dir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
const inPreferred = (file) => preferDirs.some((dir) => file.toLowerCase().startsWith(dir + '/'));

// Duplicated basenames where exactly one copy sits in a configured source dir.
const byBase = new Map();
for (const file of index.byFile.keys()) {
  const base = (file.split('/').pop() || file).toLowerCase();
  const bucket = byBase.get(base) || [];
  bucket.push(file);
  byBase.set(base, bucket);
}
const duplicated = [...byBase.entries()].filter(([, files]) => files.length > 1);
const preferredDup = duplicated
  .map(([base, files]) => ({ base, files, preferred: files.filter(inPreferred) }))
  .filter((entry) => entry.preferred.length === 1)
  .slice(0, 10);

const uniqueRoutines = routines.filter((s) => (index.byName.get(s.name.toLowerCase()) || []).length === 1);
const sample = (list, n) => list.filter((_, i) => i % Math.max(1, Math.floor(list.length / n)) === 0).slice(0, n);

const scenarios = [];

// A. Ambiguous filename + routine (the clsTileEngineX.cls failure: 65+ real errors).
for (const dup of preferredDup) {
  const preferredFile = dup.preferred[0];
  const routine = (index.byFile.get(preferredFile) || []).find((s) => routineKinds.has(s.kind) && s.scope === 'module');
  if (!routine) continue;
  scenarios.push({
    category: 'ambiguous-file read',
    tool: 'read_function',
    args: { file: dup.base, name: routine.name },
    // Must serve the PREFERRED copy specifically — any body is not enough.
    succeeds: (p) => Boolean(p.body) && !p.error && (p.file || '').toLowerCase() === preferredFile.toLowerCase(),
  });
}

// A2. Same basename in several configured dirs, routine unique to one copy
// (modCharSkins.bas client vs server): routine-aware disambiguation must pick it.
let routineDisambiguated = 0;
for (const [base, files] of duplicated) {
  if (routineDisambiguated >= 8) break;
  for (const file of files) {
    const own = (index.byFile.get(file) || []).filter((s) => routineKinds.has(s.kind) && s.scope === 'module');
    const unique = own.find((s) => !files.some((other) => other !== file && (index.byFile.get(other) || []).some((o) => o.name.toLowerCase() === s.name.toLowerCase())));
    if (!unique) continue;
    scenarios.push({
      category: 'routine-disambiguated read',
      tool: 'read_function',
      args: { file: base, name: unique.name },
      succeeds: (p) => Boolean(p.body) && !p.error && (p.file || '').toLowerCase() === file.toLowerCase(),
    });
    routineDisambiguated++;
    break;
  }
}

// A3. The exact real-world repeat offenders: files duplicated between main source
// dirs and project-discovered tool dirs the server indexes on its own. The read
// must come back from a configured source dir, never the Tools/MapEditor fork.
const knownOffenders = ['clsTileEngineX.cls', 'clsTextureMan.cls', 'modCutils.bas', 'clsParticleEngine.cls'];
for (const offender of knownOffenders) {
  const copy = [...index.byFile.keys()].find((file) => (file.split('/').pop() || '').toLowerCase() === offender.toLowerCase());
  if (!copy) continue;
  const routine = (index.byFile.get(copy) || []).find((s) => routineKinds.has(s.kind) && s.scope === 'module');
  if (!routine) continue;
  scenarios.push({
    category: 'tools-fork disambiguation',
    tool: 'read_function',
    args: { file: offender, name: routine.name },
    succeeds: (p) => Boolean(p.body) && !p.error && inPreferred(p.file || ''),
  });
}

// B. Module.Proc qualified names (agents do this constantly).
for (const routine of sample(uniqueRoutines, 10)) {
  scenarios.push({
    category: 'Module.Proc name',
    tool: 'read_function',
    args: { name: `${routine.moduleName}.${routine.name}` },
    succeeds: (p) => Boolean(p.body) && !p.error,
  });
}

// C. `symbol` arg alias (31 real silent-miss calls).
for (const routine of sample(uniqueRoutines, 8)) {
  scenarios.push({
    category: 'symbol-arg alias',
    tool: 'find_callers',
    args: { symbol: routine.name },
    succeeds: (p) => !p.error && (Array.isArray(p.callers)),
  });
  scenarios.push({
    category: 'symbol-arg alias',
    tool: 'find_symbol',
    args: { symbol: routine.name, includeBody: false },
    succeeds: (p) => !p.error && p.count >= 1,
  });
}

// D. Scoped searches: backslash scopes and bogus scopes (search_code missed 32.8%).
for (const routine of sample(uniqueRoutines, 8)) {
  const dir = routine.file.split('/').slice(0, -1).join('\\');
  scenarios.push({
    category: 'backslash scope',
    tool: 'search_code',
    args: { query: routine.name, scope: dir, maxResults: 5 },
    // scopeRelaxed must be false — otherwise this measures relaxation, not normalization.
    succeeds: (p) => !p.error && p.count >= 1 && p.search_meta?.scopeRelaxed === false,
  });
  scenarios.push({
    category: 'bogus scope relax',
    tool: 'search_code',
    args: { query: routine.name, scope: 'No/Such/Dir', maxResults: 5 },
    succeeds: (p) => !p.error && p.count >= 1 && p.search_meta?.scopeRelaxed === true,
  });
}

// E. Out-of-order multi-token queries.
let tokenScenarios = 0;
for (const routine of uniqueRoutines) {
  if (tokenScenarios >= 8) break;
  const lines = index.fileContents.get(routine.file) || [];
  const line = lines[routine.line - 1] || '';
  const identifiers = [...line.matchAll(/[A-Za-z_][A-Za-z0-9_]{3,}/g)].map((m) => m[0]).filter((w) => !/^(Public|Private|Function|Property|Declare|Optional|ByVal|ByRef|String|Long|Integer|Boolean)$/i.test(w));
  if (identifiers.length < 2) continue;
  scenarios.push({
    category: 'token-order query',
    tool: 'search_code',
    args: { query: `${identifiers[1]} ${identifiers[0]}`, maxResults: 5 },
    succeeds: (p) => !p.error && p.count >= 1,
  });
  tokenScenarios++;
}

// F. Wrong file hint, globally unique routine ("Routine not found in X": 30 real errors).
const otherFiles = [...index.byFile.keys()];
for (const routine of sample(uniqueRoutines, 8)) {
  const wrongFile = otherFiles.find((f) => f !== routine.file && (index.byFile.get(f) || []).length > 0);
  if (!wrongFile) continue;
  scenarios.push({
    category: 'wrong-file recovery',
    tool: 'read_function',
    args: { file: wrongFile.split('/').pop(), name: routine.name },
    // Recovery must serve the RIGHT file and announce itself via resolution_note.
    succeeds: (p) => Boolean(p.body) && !p.error &&
      (p.file || '').toLowerCase() === routine.file.toLowerCase() &&
      Boolean(p.resolution_note),
  });
}

// G. Bare module name without extension — must resolve to the routine's own file
// (the unique-routine fallback alone would pass a weaker predicate).
for (const routine of sample(uniqueRoutines, 6)) {
  scenarios.push({
    category: 'extensionless file',
    tool: 'read_function',
    args: { file: routine.moduleName, name: routine.name },
    succeeds: (p) => Boolean(p.body) && !p.error &&
      (p.file || '').toLowerCase() === routine.file.toLowerCase(),
  });
}

if (scenarios.length === 0) {
  console.error('No scenarios could be derived from this workspace.');
  process.exit(2);
}

// Guard against silent green: when source dirs are configured, the headline
// disambiguation categories MUST have scenarios; with no source dirs, say loudly
// that they were skipped so a 100% pass is not mistaken for full coverage.
const presentCategories = new Set(scenarios.map((s) => s.category));
const disambigCategories = ['ambiguous-file read', 'routine-disambiguated read', 'tools-fork disambiguation'];
const missingDisambig = disambigCategories.filter((c) => !presentCategories.has(c));
if (preferDirs.length > 0 && missingDisambig.length === disambigCategories.length) {
  console.error(`FAIL: source dirs are configured but no disambiguation scenarios could be derived (${missingDisambig.join(', ')}). The headline rescue paths would go unmeasured.`);
  process.exit(2);
}
if (missingDisambig.length > 0) {
  console.error(`WARNING: categories without scenarios on this workspace: ${missingDisambig.join(', ')}`);
}

// ── Run all scenarios through the real MCP server ────────────────────────────
const serverScript = path.resolve('out', 'mcp', 'mcp', 'server.js');
const child = spawn(process.execPath, [serverScript], {
  env: {
    ...process.env,
    VB6_LSP_ROOT: rootDir,
    VB6_LSP_SOURCE_DIRS: sourceDirsRaw,
    VB6_LSP_TELEMETRY_ENABLED: '0',
  },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    } catch { /* ignore non-JSON */ }
  }
});

function call(id, name, toolArgs) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: toolArgs } }) + '\n');
  });
}

child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }) + '\n');
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

const stats = new Map();
const failures = [];
let idCounter = 1;
const startedAll = performance.now();

for (const scenario of scenarios) {
  const started = performance.now();
  const response = await call(idCounter++, scenario.tool, scenario.args);
  const elapsed = performance.now() - started;
  let parsed = {};
  try {
    parsed = JSON.parse(response.result.content[0].text);
  } catch { /* leave empty */ }
  const ok = scenario.succeeds(parsed);
  const bucket = stats.get(scenario.category) || { total: 0, ok: 0, ms: [] };
  bucket.total++;
  if (ok) bucket.ok++; else failures.push({ category: scenario.category, tool: scenario.tool, args: scenario.args, error: parsed.message || parsed.error_kind || 'no results' });
  bucket.ms.push(elapsed);
  stats.set(scenario.category, bucket);
}

child.kill();

const totalMs = performance.now() - startedAll;
let total = 0;
let totalOk = 0;
console.log(`\nAgent-rescue benchmark — ${rootDir}`);
console.log(`${index.files.length} files, ${index.symbols.length} symbols, ${scenarios.length} scenarios in ${(totalMs / 1000).toFixed(1)}s\n`);
console.log('category\tok/total\trate\tp50_ms');
for (const [category, bucket] of stats) {
  total += bucket.total;
  totalOk += bucket.ok;
  const sorted = [...bucket.ms].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)] || 0;
  console.log(`${category}\t${bucket.ok}/${bucket.total}\t${(bucket.ok / bucket.total * 100).toFixed(0)}%\t${p50.toFixed(0)}`);
}
const overall = totalOk / total;
console.log(`\nOVERALL: ${totalOk}/${total} (${(overall * 100).toFixed(1)}%)`);

if (failures.length > 0) {
  console.log('\nFailures:');
  for (const failure of failures.slice(0, 20)) {
    console.log(`  [${failure.category}] ${failure.tool} ${JSON.stringify(failure.args).slice(0, 120)} -> ${failure.error}`);
  }
}

// Quality gate: these shapes used to fail ~100% of the time; demand near-total rescue now.
const THRESHOLD = Number(process.env.VB6_BENCH_THRESHOLD || 0.95);
if (overall < THRESHOLD) {
  console.error(`\nFAIL: overall rescue rate ${(overall * 100).toFixed(1)}% < ${(THRESHOLD * 100).toFixed(0)}%`);
  process.exit(1);
}
console.log(`\nPASS (threshold ${(THRESHOLD * 100).toFixed(0)}%)`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item === '--root') parsed.root = argv[++i];
    else if (item === '--source-dirs') parsed.sourceDirs = argv[++i];
  }
  return parsed;
}
