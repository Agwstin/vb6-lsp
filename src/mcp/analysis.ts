import { MCPIndex, MCPSymbol } from '../server/indexer/mcp-bridge';
import { findIdentifierOccurrences, stripInlineComment } from '../server/indexer/parser';
import { formatSignature } from './utils';

export interface DerivedCache {
  routineSymbols: MCPSymbol[];
  routineNames: Set<string>;
  callersByName: Map<string, Set<string>>;
  calleesByName: Map<string, Set<string>>;
  referencesByName: Map<string, Array<{ file: string; line: number; context: string }>>;
}

export function buildDerivedCache(index: MCPIndex): DerivedCache {
  const routineSymbols = index.symbols.filter((symbol) =>
    symbol.scope === 'module' &&
    (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property' || symbol.kind === 'Declare'),
  );
  const routineNames = new Set(routineSymbols.map((symbol) => symbol.name.toLowerCase()));
  const callersByName = new Map<string, Set<string>>();
  const calleesByName = new Map<string, Set<string>>();

  for (const routine of routineSymbols) {
    const lines = index.fileContents.get(routine.file);
    if (!lines) continue;

    const calleeSet = calleesByName.get(routine.name.toLowerCase()) || new Set<string>();
    for (let lineIndex = routine.line - 1; lineIndex < Math.min(lines.length, routine.endLine); lineIndex++) {
      const occurrences = findIdentifierOccurrences(stripInlineComment(lines[lineIndex] || ''));
      for (const occurrence of occurrences) {
        const lower = occurrence.name.toLowerCase();
        if (!routineNames.has(lower)) continue;
        if (lower === routine.name.toLowerCase()) continue;

        calleeSet.add(lower);
        const callers = callersByName.get(lower) || new Set<string>();
        callers.add(routine.name.toLowerCase());
        callersByName.set(lower, callers);
      }
    }
    calleesByName.set(routine.name.toLowerCase(), calleeSet);
  }

  return {
    routineSymbols,
    routineNames,
    callersByName,
    calleesByName,
    referencesByName: new Map(),
  };
}

export function explainSymbol(index: MCPIndex, derived: DerivedCache, symbols: MCPSymbol[]) {
  const primary = symbols[0];
  const name = primary?.name || '';
  const lower = name.toLowerCase();
  const callers = [...(derived.callersByName.get(lower) || new Set())];
  const callees = [...(derived.calleesByName.get(lower) || new Set())];
  const relatedModules = [...new Set(symbols.map((symbol) => symbol.moduleName))];
  const suspiciousDuplicates = symbols.length > 1
    ? symbols.filter((symbol) => symbol.visibility === 'Public').map((symbol) => `${symbol.moduleName}:${symbol.line}`)
    : [];

  return {
    name,
    mostLikelyDefinition: primary
      ? {
          file: primary.file,
          moduleName: primary.moduleName,
          line: primary.line,
          kind: primary.kind,
          visibility: primary.visibility,
          signature: formatSignature(primary),
        }
      : null,
    visibilityScope: primary ? `${primary.visibility} ${primary.scope}` : '',
    relatedModules,
    callers,
    callees,
    suspiciousDuplicates,
    summary: primary ? summarizeSymbol(primary, callers.length, callees.length) : '',
  };
}

export function summarizeSymbol(symbol: MCPSymbol, callerCount: number, calleeCount: number): string {
  const parts = [
    `${symbol.visibility} ${symbol.kind} ${symbol.name}`,
    `in ${symbol.moduleName}`,
  ];
  if (symbol.returnType) parts.push(`returns ${symbol.returnType}`);
  if (symbol.params.length > 0) parts.push(`${symbol.params.length} params`);
  parts.push(`${callerCount} callers`);
  parts.push(`${calleeCount} callees`);
  return parts.join(', ');
}

export function getCallers(derived: DerivedCache, name: string): string[] {
  return [...(derived.callersByName.get(name.toLowerCase()) || new Set())];
}

export function getCallees(derived: DerivedCache, name: string): string[] {
  return [...(derived.calleesByName.get(name.toLowerCase()) || new Set())];
}

export function traceFlow(derived: DerivedCache, name: string, maxDepth = 3) {
  const visited = new Set<string>();
  const trace: Array<{ depth: number; from: string; to: string }> = [];
  const queue: Array<{ depth: number; name: string }> = [{ depth: 0, name: name.toLowerCase() }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= maxDepth) continue;
    if (visited.has(current.name)) continue;
    visited.add(current.name);

    const callees = getCallees(derived, current.name);
    for (const callee of callees) {
      trace.push({ depth: current.depth + 1, from: current.name, to: callee });
      queue.push({ depth: current.depth + 1, name: callee });
    }
  }

  return trace;
}

export function findStateMutations(index: MCPIndex, name: string, maxResults = 50) {
  const lower = name.toLowerCase();
  const results: Array<{ file: string; line: number; context: string; mutationKind: string }> = [];
  const patterns = [
    new RegExp(`\\b${escapeRegex(name)}\\b\\s*=`, 'i'),
    new RegExp(`\\bSet\\s+${escapeRegex(name)}\\b\\s*=`, 'i'),
  ];

  for (const [filePath, lines] of index.fileContents) {
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || raw.trimStart().startsWith("'")) continue;
      const match = patterns.find((pattern) => pattern.test(raw));
      if (!match) continue;

      results.push({
        file: filePath,
        line: i + 1,
        context: raw.trim(),
        mutationKind: raw.toLowerCase().includes(`set ${lower}`) ? 'set-assignment' : 'assignment',
      });
      if (results.length >= maxResults) return results;
    }
  }

  return results;
}

export function findEntrypoints(index: MCPIndex, mode: 'network' | 'ui') {
  const patterns = mode === 'network'
    ? [/(handle|process|parse|send|recv|read|write|packet|socket|protocol|winsock|tcp)/i, /(tcp|socket|winsock|packet|network|protocol)/i]
    : [/(show|hide|render|click|keypress|mousedown|mouseup|mouse|load|focus)/i, /(frm|ui)/i];

  return index.symbols.filter((symbol) =>
    symbol.scope === 'module' &&
    (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property') &&
    (patterns[0].test(symbol.name) || patterns[1].test(symbol.moduleName) || patterns[1].test(symbol.file)),
  ).map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    moduleName: symbol.moduleName,
    file: symbol.file,
    line: symbol.line,
    signature: formatSignature(symbol),
  }));
}

export function findRelatedSymbols(index: MCPIndex, derived: DerivedCache, name: string) {
  const lower = name.toLowerCase();
  const base = index.byName.get(lower) || [];
  const modules = new Set(base.map((symbol) => symbol.moduleName.toLowerCase()));
  const related = index.symbols.filter((symbol) =>
    modules.has(symbol.moduleName.toLowerCase()) ||
    derived.callersByName.get(lower)?.has(symbol.name.toLowerCase()) ||
    derived.calleesByName.get(lower)?.has(symbol.name.toLowerCase()) ||
    symbol.name.toLowerCase().includes(lower),
  );

  return related
    .slice(0, 50)
    .map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      moduleName: symbol.moduleName,
      file: symbol.file,
      line: symbol.line,
      signature: formatSignature(symbol),
      matchReason: modules.has(symbol.moduleName.toLowerCase()) ? 'same-module' : symbol.name.toLowerCase().includes(lower) ? 'name-match' : 'call-graph',
    }));
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
