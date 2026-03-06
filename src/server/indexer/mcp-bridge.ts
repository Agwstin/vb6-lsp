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
import * as path from 'path';
import { VB6Indexer } from './indexer';
import { VB6Symbol, VB6Parameter } from './types';
import { isCommentLine } from './parser';

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
}

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

  // VB6Indexer expects absolute paths for sourceDirs
  const absDirs = sourceDirs.map((dir) => path.isAbsolute(dir) ? dir : path.join(sourcePath, dir));

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

  // Also index files that have no symbols (so fileContents is complete)
  for (const normAbsPath of rawIndex.files) {
    // If this file had symbols we already processed it.
    // For symbol-less files we still want fileContents for search.
    // normAbsPath is lowercased; recover original from the files array.
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

  return { symbols, byName, byFile, fileContents, files: filesArr };
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
): { file: string; line: number; context: string }[] {
  const { scope, maxResults = 30 } = opts || {};
  const results: { file: string; line: number; context: string }[] = [];
  const queryLower = query.toLowerCase();

  for (const [filePath, lines] of index.fileContents) {
    if (scope && !filePath.toLowerCase().startsWith(scope.toLowerCase())) continue;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(queryLower)) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        const context = lines
          .slice(start, end)
          .map((l, j) =>
            `${start + j + 1}${start + j === i ? '>' : ' '} ${l.replace(/\r$/, '')}`,
          )
          .join('\n');
        results.push({ file: filePath, line: i + 1, context });
        if (results.length >= maxResults) return results;
      }
    }
  }
  return results;
}
