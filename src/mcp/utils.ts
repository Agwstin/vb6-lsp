import { MCPSymbol, MCPIndex } from '../server/indexer/mcp-bridge';
import { stripVB6ComponentExtension } from '../shared/components';

export function formatSignature(symbol: MCPSymbol): string {
  let text = `${symbol.visibility} ${symbol.kind} ${symbol.name}`;
  if (symbol.params.length > 0) {
    const paramText = symbol.params.map((param) => {
      let value = '';
      if (param.optional) value += 'Optional ';
      if (param.passing) value += `${param.passing} `;
      value += param.name;
      if (param.type) value += ` As ${param.type}`;
      if (param.defaultValue) value += ` = ${param.defaultValue}`;
      return value;
    }).join(', ');
    text += `(${paramText})`;
  } else if (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property' || symbol.kind === 'Declare') {
    text += '()';
  }
  if (symbol.returnType) text += ` As ${symbol.returnType}`;
  return text;
}

export function findFileSymbols(index: MCPIndex, file: string): { filePath: string; symbols: MCPSymbol[] } | null {
  const resolution = resolveFileSymbols(index, file);
  return resolution.match;
}

export interface FileResolutionOptions {
  /** Workspace-relative dirs (forward slashes) to prefer when several files share a name. */
  preferDirs?: string[];
  /** When ambiguous, prefer the candidate that actually contains this routine. */
  routineName?: string;
}

export interface FileResolution {
  match: { filePath: string; symbols: MCPSymbol[] } | null;
  /** Ranked best-first when ambiguous. */
  candidates: string[];
  ambiguity: 'none' | 'ambiguous';
  /** Set when an ambiguous name was auto-resolved, explains why. */
  resolution?: string;
}

export function resolveFileSymbols(
  index: MCPIndex,
  file: string,
  opts?: FileResolutionOptions,
): FileResolution {
  const raw = file.replace(/\\/g, '/');
  const normalized = raw.toLowerCase();
  const trimmed = normalized.replace(/^\.?\//, '');
  const fileName = trimmed.split('/').pop() || trimmed;
  if (!trimmed) {
    return { match: null, candidates: [], ambiguity: 'none' };
  }

  const entries = [...index.byFile.entries()].map(([filePath, symbols]) => ({ filePath, symbols }));

  const exactRelPath = entries.filter(({ filePath }) => filePath.toLowerCase() === trimmed);
  if (exactRelPath.length === 1) {
    return { match: exactRelPath[0], candidates: [], ambiguity: 'none' };
  }

  const exactFileName = entries.filter(({ filePath }) => filePath.toLowerCase().split('/').pop() === fileName);
  if (exactFileName.length === 1) {
    return { match: exactFileName[0], candidates: [], ambiguity: 'none' };
  }

  const suffixMatches = entries.filter(({ filePath }) => filePath.toLowerCase().endsWith(trimmed));
  if (suffixMatches.length === 1) {
    return { match: suffixMatches[0], candidates: [], ambiguity: 'none' };
  }

  let ambiguousSet = suffixMatches.length > 0 ? suffixMatches : exactFileName;

  if (ambiguousSet.length === 0) {
    // Fuzzy rescue: only an EXACT normalized basename (ignores case, separators,
    // missing extension) may auto-match. Contains-matches are candidates only —
    // auto-matching them would hijack lookups for genuinely-new files on disk
    // before the stale-index probe gets a chance to reindex.
    const target = normalizeFileToken(fileName);
    if (target.length >= 3) {
      const fuzzy = entries.filter(({ filePath }) => {
        const base = filePath.split('/').pop() || filePath;
        const baseNorm = normalizeFileToken(base);
        return baseNorm === target || baseNorm.startsWith(target) || baseNorm.includes(target);
      });
      const exactNorm = fuzzy.filter(({ filePath }) => {
        const base = filePath.split('/').pop() || filePath;
        return normalizeFileToken(base) === target;
      });
      if (exactNorm.length === 1) {
        return { match: exactNorm[0], candidates: [], ambiguity: 'none', resolution: 'fuzzy-filename' };
      }
      ambiguousSet = exactNorm.length > 0 ? exactNorm : fuzzy;
    }
  }

  if (ambiguousSet.length > 1) {
    const preferDirs = (opts?.preferDirs || [])
      .map((dir) => dir.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '').toLowerCase())
      .filter(Boolean);
    const routineLower = opts?.routineName ? opts.routineName.toLowerCase() : '';
    // The directory portion the caller actually typed is the strongest signal:
    // 'AppB/modShared.bas' must never resolve to AppA just because AppA is preferred.
    const requestedDir = trimmed.includes('/') ? trimmed.slice(0, trimmed.lastIndexOf('/')) : '';

    const ranked = ambiguousSet
      .map((entry) => {
        const pathLower = entry.filePath.toLowerCase();
        const matchesRequestedDir = requestedDir
          ? pathLower.startsWith(requestedDir + '/') || pathLower.includes('/' + requestedDir + '/')
          : false;
        const hasRoutine = routineLower
          ? entry.symbols.some((symbol) =>
            symbol.name.toLowerCase() === routineLower && isRoutineKind(symbol.kind))
          : false;
        const inPreferred = preferDirs.some((dir) => pathLower.startsWith(dir + '/'));
        return { entry, matchesRequestedDir, hasRoutine, inPreferred };
      })
      .sort((left, right) =>
        Number(right.matchesRequestedDir) - Number(left.matchesRequestedDir) ||
        Number(right.hasRoutine) - Number(left.hasRoutine) ||
        Number(right.inPreferred) - Number(left.inPreferred) ||
        left.entry.filePath.length - right.entry.filePath.length,
      );

    const top = ranked[0];
    const second = ranked[1];
    const strictlyBetter =
      top.matchesRequestedDir !== second.matchesRequestedDir ||
      top.hasRoutine !== second.hasRoutine ||
      top.inPreferred !== second.inPreferred;
    if (strictlyBetter) {
      const resolution = top.matchesRequestedDir !== second.matchesRequestedDir
        ? 'matches-request-path'
        : top.hasRoutine !== second.hasRoutine
          ? 'contains-routine'
          : 'preferred-source-dir';
      return {
        match: top.entry,
        candidates: ranked.slice(1).map(({ entry }) => entry.filePath),
        ambiguity: 'none',
        resolution,
      };
    }
    return {
      match: null,
      candidates: ranked.map(({ entry }) => entry.filePath),
      ambiguity: 'ambiguous',
    };
  }

  const candidates = ambiguousSet.map(({ filePath }) => filePath);
  return {
    match: null,
    candidates,
    ambiguity: candidates.length > 1 ? 'ambiguous' : 'none',
  };
}

function normalizeFileToken(value: string): string {
  return stripVB6ComponentExtension(value.toLowerCase()).replace(/[^a-z0-9]/g, '');
}

function isRoutineKind(kind: string): boolean {
  return kind === 'Sub' || kind === 'Function' || kind === 'Property' || kind === 'Declare';
}

export function readSymbolBody(index: MCPIndex, symbol: MCPSymbol, maxLines?: number): string {
  const lines = index.fileContents.get(symbol.file);
  if (!lines) return '';

  const bodyLength = symbol.endLine - symbol.line + 1;
  const limit = typeof maxLines === 'number' ? Math.max(1, maxLines) : bodyLength;
  const slice = lines.slice(symbol.line - 1, Math.min(symbol.endLine, symbol.line - 1 + limit));
  const body = slice.map((line, offset) => `${symbol.line + offset} ${line.replace(/\r$/, '')}`).join('\n');
  if (limit < bodyLength) {
    return `${body}\n... (${bodyLength - limit} more lines)`;
  }
  return body;
}

export function summarizeModule(index: MCPIndex, filePath: string, symbols: MCPSymbol[]) {
  const moduleName = symbols[0]?.moduleName || filePath;
  const counts = new Map<string, number>();

  for (const symbol of symbols) {
    counts.set(symbol.kind, (counts.get(symbol.kind) || 0) + 1);
  }

  return {
    file: filePath,
    moduleName,
    totalSymbols: symbols.length,
    countsByKind: Object.fromEntries([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    publicSymbols: symbols
      .filter((symbol) => symbol.visibility === 'Public')
      .map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
      })),
  };
}
