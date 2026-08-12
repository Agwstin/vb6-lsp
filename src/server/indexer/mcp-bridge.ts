/**
 * MCP Bridge — wraps the VB6Indexer (TypeScript) into the same interface
 * that vb6-index.mjs provided, for drop-in replacement in external MCP consumers.
 *
 * Key improvements over vb6-index.mjs:
 *  - Two-pass parsing (local vars excluded from module-level index)
 *  - Declare functions parsed correctly (bug fix)
 *  - params[] and returnType on every symbol
 *  - moduleName on every symbol
 *  - findReferences filters comment lines
 *  - Variable and Event kinds indexed
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { VB6Indexer } from './indexer';
import { VB6Symbol, VB6Parameter } from './types';
import { isCommentLine } from './parser';
import { isSupportedVB6Source } from '../../shared/components';

// ── Types matching the old vb6-index.mjs interface ───────────────────────────

export interface MCPSymbol {
  name: string;
  kind: string;
  visibility: string;
  scope: string;
  moduleName: string;
  file: string;         // relPath (for compat with server.mjs tools)
  line: number;
  endLine: number;
  signature: string;
  params: VB6Parameter[];
  returnType: string;
  accessor?: string;
  containerName?: string;
  containerKind?: string;
  containerLine?: number;
}

export interface MCPIndex {
  symbols: MCPSymbol[];
  byName: Map<string, MCPSymbol[]>;
  byFile: Map<string, MCPSymbol[]>;
  fileContents: Map<string, string[]>;
  files: { name: string; dir: string; path: string }[];
  /** Snapshot of indexed files at build time, used for staleness checks. */
  fileSnapshot?: Array<{ path: string; size: number; mtimeMs: number }>;
}

export interface MCPSearchResult {
  file: string;
  line: number;
  context: string;
  matchKind?: 'text' | 'symbol' | 'file' | 'normalized' | 'token';
  score?: number;
}

export interface MCPSearchMeta {
  /** Which stage produced the hits: 'primary' (symbol/text/normalized), 'token' (all-tokens-on-line fallback), or 'none'. */
  stage: 'primary' | 'token' | 'none';
  /** True when the requested scope had zero hits and results come from outside it. */
  scopeRelaxed: boolean;
  scope?: string;
  /** True when fallback stages were cut short by the time budget (batch calls share one). */
  budgetExhausted?: boolean;
}

interface IndexCacheFile {
  cacheVersion: number;
  key: string;
  createdAt: string;
  files: Array<{ path: string; size: number; mtimeMs: number }>;
  symbols: MCPSymbol[];
  fileContents: Array<[string, string[]]>;
  filesArr: { name: string; dir: string; path: string }[];
}

const INDEX_CACHE_VERSION = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── buildVB6Index ────────────────────────────────────────────────────────────

/**
 * Same signature as vb6-index.mjs `buildVB6Index`.
 * Internally uses VB6Indexer for better parsing.
 */
export function buildVB6Index(sourcePath: string, sourceDirs: string[]): MCPIndex {
  const start = Date.now();
  const absDirs = sourceDirs.map((dir) => path.isAbsolute(dir) ? dir : path.join(sourcePath, dir));
  const sourceFiles = collectSourceFiles(absDirs);
  const cacheKey = createIndexCacheKey(sourcePath, absDirs);
  const cached = readIndexCache(sourcePath, cacheKey, sourceFiles);
  if (cached) {
    const elapsed = Date.now() - start;
    console.error(`[vb6-index] Loaded ${cached.symbols.length} symbols from ${cached.files.length} cached files in ${elapsed}ms`);
    cached.fileSnapshot = snapshotFiles(sourceFiles);
    return cached;
  }

  const indexer = new VB6Indexer(sourcePath, absDirs);
  indexer.buildFullIndex();
  const rawIndex = indexer.getIndex();

  // Convert to MCP-compatible format (relPath-keyed maps)
  const symbols: MCPSymbol[] = [];
  const byName = new Map<string, MCPSymbol[]>();
  const byFile = new Map<string, MCPSymbol[]>();
  const fileContents = new Map<string, string[]>();
  const filesArr: { name: string; dir: string; path: string }[] = [];

  const seen = new Set<string>();

  for (const [, fileSyms] of rawIndex.byFile) {
    if (fileSyms.length === 0) continue;

    const relPath = fileSyms[0].relPath;
    const absFilePath = fileSyms[0].file;

    if (seen.has(relPath)) continue;
    seen.add(relPath);

    // Read file contents (latin1 to preserve VB6 extended ASCII)
    try {
      const content = fs.readFileSync(absFilePath, 'latin1');
      fileContents.set(relPath, content.split('\n'));
    } catch {
      // skip unreadable
    }

    filesArr.push({
      name: path.basename(absFilePath),
      dir: path.dirname(relPath),
      path: absFilePath,
    });

    // Convert VB6Symbols to MCPSymbols (file → relPath)
    const mcpSyms: MCPSymbol[] = [];
    for (const sym of fileSyms) {
      const mcp: MCPSymbol = {
        name: sym.name,
        kind: sym.kind,
        visibility: sym.visibility,
        scope: sym.scope,
        moduleName: sym.moduleName,
        file: relPath,
        line: sym.line,
        endLine: sym.endLine,
        signature: sym.signature.slice(0, 300),
        params: sym.params,
        returnType: sym.returnType,
        accessor: sym.accessor,
        containerName: sym.containerName,
        containerKind: sym.containerKind,
        containerLine: sym.containerLine,
      };
      symbols.push(mcp);
      mcpSyms.push(mcp);
    }
    byFile.set(relPath, mcpSyms);
  }

  // Also index files that have no symbols so text search is complete.
  for (const absFilePath of sourceFiles) {
    const relPath = path.relative(sourcePath, absFilePath).replace(/\\/g, '/');
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    try {
      const content = fs.readFileSync(absFilePath, 'latin1');
      fileContents.set(relPath, content.split('\n'));
    } catch {
      // skip unreadable
    }

    filesArr.push({
      name: path.basename(absFilePath),
      dir: path.dirname(relPath),
      path: absFilePath,
    });
    byFile.set(relPath, []);
  }

  // Build byName
  for (const sym of symbols) {
    const key = sym.name.toLowerCase();
    const arr = byName.get(key);
    if (arr) {
      arr.push(sym);
    } else {
      byName.set(key, [sym]);
    }
  }

  const elapsed = Date.now() - start;
  console.error(`[vb6-index] Indexed ${symbols.length} symbols from ${seen.size} files in ${elapsed}ms`);

  const index: MCPIndex = { symbols, byName, byFile, fileContents, files: filesArr, fileSnapshot: snapshotFiles(sourceFiles) };
  writeIndexCache(sourcePath, cacheKey, sourceFiles, index);
  return index;
}

/**
 * Cheap staleness probe: re-walk the source dirs and compare the file snapshot
 * (paths, sizes, mtimes) against what the in-memory index was built from.
 * Lets a long-lived MCP server notice new/edited/deleted files and rebuild.
 */
export function indexSnapshotChanged(index: MCPIndex, sourcePath: string, sourceDirs: string[]): boolean {
  if (!index.fileSnapshot) return false;
  const absDirs = sourceDirs.map((dir) => path.isAbsolute(dir) ? dir : path.join(sourcePath, dir));
  let currentFiles: string[];
  try {
    currentFiles = collectSourceFiles(absDirs);
  } catch {
    return false;
  }
  try {
    return !sameFileSnapshot(index.fileSnapshot, currentFiles);
  } catch {
    // A file disappeared between the walk and the stat — definitely stale.
    return true;
  }
}

// ── findReferences (with comment filtering) ──────────────────────────────────

/**
 * Same signature as vb6-index.mjs `findReferences`,
 * but filters out matches inside comment lines.
 */
export function findReferences(
  index: MCPIndex,
  name: string,
  maxResults: number = 30,
): { file: string; line: number; context: string }[] {
  const results: { file: string; line: number; context: string }[] = [];
  const re = new RegExp('\\b' + escapeRegex(name) + '\\b', 'i');

  for (const [filePath, lines] of index.fileContents) {
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      // Skip comments (new vs old indexer)
      if (isCommentLine(raw)) continue;

      if (re.test(raw)) {
        // Skip the definition line itself
        const syms = index.byName.get(name.toLowerCase());
        const isDef = syms && syms.some(s => s.file === filePath && s.line === i + 1);
        if (isDef) continue;

        results.push({
          file: filePath,
          line: i + 1,
          context: raw.trimStart().replace(/\r$/, '').slice(0, 150),
        });
        if (results.length >= maxResults) return results;
      }
    }
  }
  return results;
}

// ── searchCode (same logic as old, kept for compat) ──────────────────────────

export function searchCode(
  index: MCPIndex,
  query: string,
  opts?: { scope?: string; maxResults?: number },
): MCPSearchResult[] {
  return searchCodeSmart(index, query, opts).results;
}

/**
 * Normalize a user-supplied scope: backslashes to slashes, no leading ./, lowercased.
 */
function normalizeScope(scope?: string): string {
  if (!scope) return '';
  return scope.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * A file is in scope when the scope is a path prefix OR a segment-anchored
 * fragment ("Server/source", "modUIMapa.bas", "source/modClient.bas" all work).
 */
function fileInScope(filePathLower: string, scope: string): boolean {
  if (!scope) return true;
  return filePathLower.startsWith(scope) || filePathLower.includes('/' + scope);
}

/**
 * Search with rescue fallbacks. Stages:
 *  1. primary: symbol-name ranking + literal/normalized line scan (within scope)
 *  2. token:   every whitespace-separated token present on the same line, any order
 *  3. scope relax: if a scope was given and produced nothing, retry stages 1-2 without it
 */
export function searchCodeSmart(
  index: MCPIndex,
  query: string,
  opts?: { scope?: string; maxResults?: number; fallbackDeadline?: number },
): { results: MCPSearchResult[]; meta: MCPSearchMeta } {
  const { maxResults = 30 } = opts || {};
  const scope = normalizeScope(opts?.scope);
  // Fallback stages (token scan, scope relaxation) are full-workspace scans;
  // bound them so a batch of zero-hit queries cannot pile up multi-second sweeps.
  const deadline = opts?.fallbackDeadline ?? Date.now() + 2000;
  let budgetExhausted = false;
  const budgetLeft = () => {
    if (Date.now() <= deadline) return true;
    budgetExhausted = true;
    return false;
  };

  let results = searchCodePrimary(index, query, scope, maxResults);
  let stage: MCPSearchMeta['stage'] = results.length > 0 ? 'primary' : 'none';

  if (results.length === 0 && budgetLeft()) {
    results = searchCodeTokens(index, query, scope, maxResults, deadline);
    if (results.length > 0) stage = 'token';
  }

  let scopeRelaxed = false;
  if (results.length === 0 && scope && budgetLeft()) {
    results = searchCodePrimary(index, query, '', maxResults);
    if (results.length > 0) {
      stage = 'primary';
    } else if (budgetLeft()) {
      results = searchCodeTokens(index, query, '', maxResults, deadline);
      if (results.length > 0) stage = 'token';
    }
    scopeRelaxed = results.length > 0;
  }

  return {
    results,
    meta: {
      stage,
      scopeRelaxed,
      scope: opts?.scope ? String(opts.scope) : undefined,
      ...(budgetExhausted ? { budgetExhausted: true } : {}),
    },
  };
}

function searchCodePrimary(
  index: MCPIndex,
  query: string,
  scope: string,
  maxResults: number,
): MCPSearchResult[] {
  const results: MCPSearchResult[] = [];
  const queryLower = query.toLowerCase();
  const normalizedQuery = normalizeIdentifier(query);
  const seen = new Set<string>();

  if (queryLower) {
    for (const symbol of index.symbols) {
      if (scope && !fileInScope(symbol.file.toLowerCase(), scope)) continue;

      const nameLower = symbol.name.toLowerCase();
      const moduleLower = symbol.moduleName.toLowerCase();
      const normalizedName = normalizeIdentifier(symbol.name);
      let score = 0;
      let matchKind: MCPSearchResult['matchKind'] = 'symbol';

      if (nameLower === queryLower) score = 100;
      else if (normalizedName === normalizedQuery) {
        score = 92;
        matchKind = 'normalized';
      } else if (nameLower.startsWith(queryLower)) score = 82;
      else if (normalizedName.startsWith(normalizedQuery)) {
        score = 78;
        matchKind = 'normalized';
      } else if (nameLower.includes(queryLower) || moduleLower.includes(queryLower)) score = 70;
      else if (normalizedQuery && normalizedName.includes(normalizedQuery)) {
        score = 66;
        matchKind = 'normalized';
      }

      if (score === 0) continue;
      const key = `${symbol.file}:${symbol.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        file: symbol.file,
        line: symbol.line,
        context: `${symbol.line}> ${symbol.signature}`,
        matchKind,
        score,
      });
    }
  }

  if (results.length >= maxResults) {
    return results.sort((left, right) => (right.score || 0) - (left.score || 0)).slice(0, maxResults);
  }

  for (const [filePath, lines] of index.fileContents) {
    const fileLower = filePath.toLowerCase();
    if (scope && !fileInScope(fileLower, scope)) continue;

    // Filename matches are emitted ONCE per file (basename only) — never per line,
    // so a path-flavored query cannot flood the result set with a file's whole body.
    const baseName = fileLower.split('/').pop() || fileLower;
    const baseMatch =
      (Boolean(queryLower) && baseName.includes(queryLower)) ||
      (Boolean(normalizedQuery) && normalizeIdentifier(baseName).includes(normalizedQuery));
    if (baseMatch) {
      const key = `${filePath}:file`;
      if (!seen.has(key)) {
        seen.add(key);
        results.push({
          file: filePath,
          line: 1,
          context: `(filename match) ${filePath}`,
          matchKind: 'file',
          score: 40,
        });
        if (results.length >= maxResults) {
          return results.sort((left, right) => (right.score || 0) - (left.score || 0)).slice(0, maxResults);
        }
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      const textMatch = queryLower && lineLower.includes(queryLower);
      // Normalizing every line is expensive; only do it when the literal scan failed.
      const normalizedMatch = !textMatch && normalizedQuery && normalizeIdentifier(lines[i]).includes(normalizedQuery);

      if (textMatch || normalizedMatch) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        const context = lines
          .slice(start, end)
          .map((l, j) =>
            `${start + j + 1}${start + j === i ? '>' : ' '} ${l.replace(/\r$/, '')}`,
          )
          .join('\n');
        const key = `${filePath}:${i + 1}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          file: filePath,
          line: i + 1,
          context,
          matchKind: textMatch ? 'text' : 'normalized',
          score: textMatch ? 50 : 35,
        });
        if (results.length >= maxResults) {
          return results.sort((left, right) => (right.score || 0) - (left.score || 0)).slice(0, maxResults);
        }
      }
    }
  }

  return results.sort((left, right) => (right.score || 0) - (left.score || 0)).slice(0, maxResults);
}

/**
 * Fallback for multi-word queries: match lines containing ALL tokens in any order.
 * Rescues queries like "Privilegios And" / "WindowAlpha slider" that fail the literal scan.
 */
function searchCodeTokens(
  index: MCPIndex,
  query: string,
  scope: string,
  maxResults: number,
  deadline?: number,
): MCPSearchResult[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 2);
  if (tokens.length < 2) return [];

  const results: MCPSearchResult[] = [];
  for (const [filePath, lines] of index.fileContents) {
    if (deadline && Date.now() > deadline) return results;
    if (scope && !fileInScope(filePath.toLowerCase(), scope)) continue;

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      let allPresent = true;
      for (const token of tokens) {
        if (!lineLower.includes(token)) {
          allPresent = false;
          break;
        }
      }
      if (!allPresent) continue;

      results.push({
        file: filePath,
        line: i + 1,
        context: `${i + 1}> ${lines[i].replace(/\r$/, '').trimStart().slice(0, 200)}`,
        matchKind: 'token',
        score: 30,
      });
      if (results.length >= maxResults) return results;
    }
  }
  return results;
}

function collectSourceFiles(sourceDirs: string[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') continue;
        visit(full);
        continue;
      }
      if (!isSupportedVB6Source(entry.name)) continue;

      const resolved = path.resolve(full);
      const key = resolved.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(resolved);
    }
  };

  for (const dir of sourceDirs) {
    if (fs.existsSync(dir)) visit(dir);
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function createIndexCacheKey(sourcePath: string, sourceDirs: string[]): string {
  return createHash('sha256')
    .update(JSON.stringify({
      cacheVersion: INDEX_CACHE_VERSION,
      sourcePath: path.resolve(sourcePath).toLowerCase(),
      sourceDirs: sourceDirs.map((dir) => path.resolve(dir).toLowerCase()).sort(),
    }))
    .digest('hex')
    .slice(0, 16);
}

function readIndexCache(sourcePath: string, key: string, sourceFiles: string[]): MCPIndex | null {
  const filePath = cacheFilePath(sourcePath, key);
  let parsed: IndexCacheFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as IndexCacheFile;
  } catch {
    return null;
  }

  if (parsed.cacheVersion !== INDEX_CACHE_VERSION || parsed.key !== key) return null;
  if (!sameFileSnapshot(parsed.files, sourceFiles)) return null;

  const byName = new Map<string, MCPSymbol[]>();
  const byFile = new Map<string, MCPSymbol[]>();
  const fileContents = new Map<string, string[]>(parsed.fileContents);

  for (const file of parsed.filesArr) {
    byFile.set(path.relative(sourcePath, file.path).replace(/\\/g, '/'), []);
  }

  for (const symbol of parsed.symbols) {
    const nameKey = symbol.name.toLowerCase();
    const bucket = byName.get(nameKey) || [];
    bucket.push(symbol);
    byName.set(nameKey, bucket);

    const fileBucket = byFile.get(symbol.file) || [];
    fileBucket.push(symbol);
    byFile.set(symbol.file, fileBucket);
  }

  return {
    symbols: parsed.symbols,
    byName,
    byFile,
    fileContents,
    files: parsed.filesArr,
  };
}

function writeIndexCache(sourcePath: string, key: string, sourceFiles: string[], index: MCPIndex): void {
  try {
    const cacheDir = path.dirname(cacheFilePath(sourcePath, key));
    fs.mkdirSync(cacheDir, { recursive: true });
    const payload: IndexCacheFile = {
      cacheVersion: INDEX_CACHE_VERSION,
      key,
      createdAt: new Date().toISOString(),
      files: snapshotFiles(sourceFiles),
      symbols: index.symbols,
      fileContents: [...index.fileContents.entries()],
      filesArr: index.files,
    };
    fs.writeFileSync(cacheFilePath(sourcePath, key), JSON.stringify(payload), 'utf8');
  } catch {
    // Cache writes are best-effort.
  }
}

/**
 * Resolve the on-disk cache root without mutating analyzed workspaces by default.
 * `VB6_LSP_CACHE_DIR` is an explicit user-selected root; `workspace` mode keeps
 * the historical repository-local location for users who deliberately opt in.
 */
export function resolveIndexCacheRoot(sourcePath: string): string {
  const configured = process.env.VB6_LSP_CACHE_DIR?.trim();
  if (configured) return path.resolve(configured);

  const mode = process.env.VB6_LSP_CACHE_MODE?.trim().toLowerCase();
  if (mode === 'workspace' || mode === 'local') {
    return path.join(path.resolve(sourcePath), '.vb6-lsp-cache');
  }

  return path.join(resolveUserCacheBase(), 'vb6-lsp');
}

function resolveUserCacheBase(): string {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches');
  }

  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
}

function cacheFilePath(sourcePath: string, key: string): string {
  return path.join(resolveIndexCacheRoot(sourcePath), `mcp-index-${key}.json`);
}

function sameFileSnapshot(snapshot: Array<{ path: string; size: number; mtimeMs: number }>, sourceFiles: string[]): boolean {
  const current = snapshotFiles(sourceFiles);
  if (snapshot.length !== current.length) return false;
  for (let i = 0; i < snapshot.length; i++) {
    if (snapshot[i].path !== current[i].path) return false;
    if (snapshot[i].size !== current[i].size) return false;
    if (snapshot[i].mtimeMs !== current[i].mtimeMs) return false;
  }
  return true;
}

function snapshotFiles(sourceFiles: string[]): Array<{ path: string; size: number; mtimeMs: number }> {
  return sourceFiles.map((file) => {
    const stats = fs.statSync(file);
    return {
      path: path.resolve(file),
      size: stats.size,
      mtimeMs: Math.round(stats.mtimeMs),
    };
  });
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}
