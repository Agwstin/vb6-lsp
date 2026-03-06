import { MCPIndex, MCPSymbol } from '../server/indexer/mcp-bridge';
import { findIdentifierOccurrences, stripInlineComment } from '../server/indexer/parser';
import { formatSignature } from './utils';

export interface DerivedCache {
  routineSymbols: MCPSymbol[];
  routineNames: Set<string>;
  callersByName: Map<string, Set<string>>;
  calleesByName: Map<string, Set<string>>;
  symbolsByModule: Map<string, MCPSymbol[]>;
  referencesByName: Map<string, Array<{ file: string; line: number; context: string }>>;
  moduleSummaries: Map<string, unknown>;
  symbolAnalyses: Map<string, unknown>;
  relatedSymbols: Map<string, unknown>;
  entrypoints: Map<'network' | 'ui', unknown[]>;
}

export function buildDerivedCache(index: MCPIndex): DerivedCache {
  const routineSymbols = index.symbols.filter((symbol) =>
    symbol.scope === 'module' &&
    (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property' || symbol.kind === 'Declare'),
  );
  const routineNames = new Set(routineSymbols.map((symbol) => symbol.name.toLowerCase()));
  const callersByName = new Map<string, Set<string>>();
  const calleesByName = new Map<string, Set<string>>();
  const symbolsByModule = new Map<string, MCPSymbol[]>();

  for (const symbol of index.symbols) {
    const key = symbol.moduleName.toLowerCase();
    const bucket = symbolsByModule.get(key) || [];
    bucket.push(symbol);
    symbolsByModule.set(key, bucket);
  }

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
    symbolsByModule,
    referencesByName: new Map(),
    moduleSummaries: new Map(),
    symbolAnalyses: new Map(),
    relatedSymbols: new Map(),
    entrypoints: new Map(),
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
    callers: callers.slice(0, 20),
    callees: callees.slice(0, 20),
    callerCount: callers.length,
    calleeCount: callees.length,
    suspiciousDuplicates,
    summary: primary ? summarizeSymbol(primary, callers.length, callees.length) : '',
    confidence: primary ? (symbols.length === 1 ? 'high' : 'medium') : 'low',
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

export function traceInboundFlow(derived: DerivedCache, name: string, maxDepth = 3) {
  const visited = new Set<string>();
  const trace: Array<{ depth: number; from: string; to: string }> = [];
  const queue: Array<{ depth: number; name: string }> = [{ depth: 0, name: name.toLowerCase() }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= maxDepth) continue;
    if (visited.has(current.name)) continue;
    visited.add(current.name);

    const callers = getCallers(derived, current.name);
    for (const caller of callers) {
      trace.push({ depth: current.depth + 1, from: caller, to: current.name });
      queue.push({ depth: current.depth + 1, name: caller });
    }
  }

  return trace;
}

export function traceOutboundFlow(derived: DerivedCache, name: string, maxDepth = 3) {
  return traceFlow(derived, name, maxDepth);
}

export function getCachedReferences(
  derived: DerivedCache,
  index: MCPIndex,
  name: string,
  finder: (index: MCPIndex, name: string, maxResults: number) => Array<{ file: string; line: number; context: string }>,
  maxResults = 50,
) {
  const key = `${name.toLowerCase()}:${maxResults}`;
  const cached = derived.referencesByName.get(key);
  if (cached) return cached;
  const refs = finder(index, name, maxResults);
  derived.referencesByName.set(key, refs);
  return refs;
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

export function analyzeStateSymbol(
  index: MCPIndex,
  derived: DerivedCache,
  name: string,
  mutations: Array<{ file: string; line: number; context: string; mutationKind: string }>,
) {
  const symbols = index.byName.get(name.toLowerCase()) || [];
  const explanation = explainSymbol(index, derived, symbols);
  return {
    analysisKind: 'state-symbol',
    name,
    explanation,
    mutationCount: mutations.length,
    mutations,
    inbound: traceInboundFlow(derived, name, 2),
    outbound: traceOutboundFlow(derived, name, 2),
    summary: `${name} has ${mutations.length} mutation site(s) and ${explanation.callers.length} caller(s).`,
  };
}

export function findEntrypoints(index: MCPIndex, mode: 'network' | 'ui') {
  return findEntrypointsCached(index, buildDerivedCache(index), mode);
}

export function findEntrypointsCached(index: MCPIndex, derived: DerivedCache, mode: 'network' | 'ui') {
  const cached = derived.entrypoints.get(mode);
  if (cached) return cached;

  const patterns = mode === 'network'
    ? [/(handle|process|parse|send|recv|read|write|packet|socket|protocol|winsock|tcp)/i, /(tcp|socket|winsock|packet|network|protocol)/i]
    : [/(show|hide|render|click|keypress|mousedown|mouseup|mouse|load|focus)/i, /(frm|ui)/i];

  const entrypoints = index.symbols.filter((symbol) =>
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
    score: patterns[0].test(symbol.name) ? 2 : 1,
  }));

  const ranked = entrypoints.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  derived.entrypoints.set(mode, ranked);
  return ranked;
}

export function findRelatedSymbols(
  index: MCPIndex,
  derived: DerivedCache,
  name: string,
): Array<{
  name: string;
  kind: string;
  moduleName: string;
  file: string;
  line: number;
  signature: string;
  matchReason: string;
  score: number;
}> {
  const lower = name.toLowerCase();
  const cached = derived.relatedSymbols.get(lower);
  if (cached) return cached as ReturnType<typeof findRelatedSymbols>;
  const base = index.byName.get(lower) || [];
  const modules = new Set(base.map((symbol) => symbol.moduleName.toLowerCase()));
  const callers = derived.callersByName.get(lower) || new Set<string>();
  const callees = derived.calleesByName.get(lower) || new Set<string>();

  const related = index.symbols
    .map((symbol) => {
      let score = 0;
      let matchReason = '';
      if (modules.has(symbol.moduleName.toLowerCase())) {
        score = 3;
        matchReason = 'same-module';
      } else if (callers.has(symbol.name.toLowerCase()) || callees.has(symbol.name.toLowerCase())) {
        score = 2;
        matchReason = 'call-graph';
      } else if (symbol.name.toLowerCase().includes(lower)) {
        score = 1;
        matchReason = 'name-match';
      }
      return { symbol, score, matchReason };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.symbol.name.localeCompare(right.symbol.name))
    .slice(0, 50)
    .map((item) => ({
      name: item.symbol.name,
      kind: item.symbol.kind,
      moduleName: item.symbol.moduleName,
      file: item.symbol.file,
      line: item.symbol.line,
      signature: formatSignature(item.symbol),
      matchReason: item.matchReason,
      score: item.score,
    }));

  derived.relatedSymbols.set(lower, related);
  return related;
}

export function summarizeModuleForAgents(index: MCPIndex, derived: DerivedCache, filePath: string, symbols: MCPSymbol[]) {
  const cacheKey = filePath.toLowerCase();
  const cached = derived.moduleSummaries.get(cacheKey);
  if (cached) return cached;

  const routines = symbols.filter((symbol) =>
    symbol.scope === 'module' && (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property'),
  );
  const publicCount = symbols.filter((symbol) => symbol.visibility === 'Public').length;
  const summary = {
    file: filePath,
    moduleName: symbols[0]?.moduleName || filePath,
    totalSymbols: symbols.length,
    routineCount: routines.length,
    publicCount,
    keyRoutines: routines.slice(0, 12).map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.line,
      signature: formatSignature(symbol),
    })),
    summary: `${symbols[0]?.moduleName || filePath} contains ${symbols.length} indexed symbols, ${routines.length} routines, and ${publicCount} public declarations.`,
  };
  derived.moduleSummaries.set(cacheKey, summary);
  return summary;
}

export function analyzePacketHandler(index: MCPIndex, derived: DerivedCache, name: string) {
  const symbols = (index.byName.get(name.toLowerCase()) || [])
    .filter((symbol) => symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property');
  const explanation = explainSymbol(index, derived, symbols);
  return {
    ...explanation,
    category: 'packet-handler',
    likelyNetworkEntrypoint: true,
  };
}

export function analyzeUiForm(index: MCPIndex, derived: DerivedCache, filePath: string, symbols: MCPSymbol[]) {
  const controls = symbols.filter((symbol) => symbol.scope === 'member' && symbol.containerKind === 'Form');
  const routines = symbols.filter((symbol) =>
    symbol.scope === 'module' &&
    (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property') &&
    /(show|hide|render|click|keypress|mouse|load|focus)/i.test(symbol.name),
  );

  return {
    ...summarizeModuleForAgents(index, derived, filePath, symbols),
    category: 'ui-form',
    controlCount: controls.length,
    controls: controls.map((symbol) => ({
      name: symbol.name,
      type: symbol.returnType || symbol.kind,
      line: symbol.line,
    })),
    uiRoutines: routines.map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.line,
      signature: formatSignature(symbol),
    })),
  };
}

export function analyzeSymbolBundle(
  index: MCPIndex,
  derived: DerivedCache,
  name: string,
  symbols: MCPSymbol[],
  references: Array<{ file: string; line: number; context: string }>,
  mutations: Array<{ file: string; line: number; context: string; mutationKind: string }>,
) {
  const cacheKey = name.toLowerCase();
  const cached = derived.symbolAnalyses.get(cacheKey);
  if (cached) return cached;

  const explanation = explainSymbol(index, derived, symbols);
  const analysis = {
    analysisKind: 'symbol',
    name,
    definitionCount: symbols.length,
    explanation,
    references: references.slice(0, 20),
    referenceCount: references.length,
    callers: getCallers(derived, name).slice(0, 20),
    callerCount: getCallers(derived, name).length,
    callees: getCallees(derived, name).slice(0, 20),
    calleeCount: getCallees(derived, name).length,
    related: findRelatedSymbols(index, derived, name).slice(0, 20),
    mutations: mutations.slice(0, 20),
    mutationCount: mutations.length,
    summary: explanation.summary,
    nextLikelySymbols: [...getCallers(derived, name), ...getCallees(derived, name)].slice(0, 10),
  };
  derived.symbolAnalyses.set(cacheKey, analysis);
  return analysis;
}

export function analyzeModuleBundle(index: MCPIndex, derived: DerivedCache, filePath: string, symbols: MCPSymbol[]) {
  const base = summarizeModuleForAgents(index, derived, filePath, symbols) as any;
  const controls = symbols.filter((symbol) => symbol.scope === 'member' && symbol.containerKind === 'Form');
  const references = symbols.filter((symbol) => symbol.scope === 'module' && symbol.visibility === 'Public').slice(0, 15);

  return {
    analysisKind: 'module',
    ...base,
    controls: controls.map((symbol) => ({
      name: symbol.name,
      type: symbol.returnType || symbol.kind,
      line: symbol.line,
    })),
    notableSymbols: references.map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.line,
      signature: formatSignature(symbol),
    })),
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
