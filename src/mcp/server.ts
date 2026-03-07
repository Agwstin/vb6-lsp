import { Buffer } from 'node:buffer';
import { buildVB6Index, findReferences, searchCode } from '../server/indexer/mcp-bridge';
import { resolveWorkspaceConfig, VB6ServerSettings } from '../server/config';
import { findFileSymbols, formatSignature, readSymbolBody, resolveFileSymbols, summarizeModule } from './utils';
import { analyzeModuleBundle, analyzePacketHandler, analyzeProjectReferenceImpact, analyzeStartupFlow, analyzeStateSymbol, analyzeSymbolBundle, analyzeUiForm, buildDerivedCache, DerivedCache, explainSymbol, findEntrypointsCached, findRelatedSymbols, findStateMutations, getCachedReferences, getCallees, getCallers, summarizeModuleForAgents, traceFlow, traceInboundFlow, traceOutboundFlow } from './analysis';
import { createTelemetryContext, recordTelemetry, summarizeToolResult } from './telemetry';

const workspaceConfig = resolveWorkspaceConfig({
  rootUri: process.env.VB6_LSP_ROOT ? `file:///${process.env.VB6_LSP_ROOT.replace(/\\/g, '/')}` : undefined,
  settings: extractSettingsFromEnv(),
});

let cachedIndex: ReturnType<typeof buildVB6Index> | null = null;
let indexedAt: string | null = null;
let derivedCache: DerivedCache | null = null;
const telemetry = createTelemetryContext(workspaceConfig.rootDir);

function extractSettingsFromEnv(): VB6ServerSettings {
  return {
    workspaceRoot: process.env.VB6_LSP_ROOT,
    projectFiles: splitEnvList(process.env.VB6_LSP_PROJECT_FILES),
    sourcePaths: splitEnvList(process.env.VB6_LSP_SOURCE_DIRS),
    preferProjectFiles: process.env.VB6_LSP_PREFER_PROJECT_FILES
      ? process.env.VB6_LSP_PREFER_PROJECT_FILES.toLowerCase() !== 'false'
      : undefined,
  };
}

function splitEnvList(value?: string): string[] | undefined {
  if (!value) return undefined;
  const entries = value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function ensureIndex(force = false) {
  const cacheHit = Boolean(cachedIndex) && !force;
  if (!cachedIndex || force) {
    cachedIndex = buildVB6Index(workspaceConfig.rootDir, workspaceConfig.sourceDirs);
    indexedAt = new Date().toISOString();
    derivedCache = null;
  }
  return { index: cachedIndex, cacheHit };
}

function ensureDerived(force = false) {
  const indexState = ensureIndex(force);
  const derivedCacheHit = Boolean(derivedCache) && !force;
  if (!derivedCache || force) {
    derivedCache = buildDerivedCache(indexState.index);
  }
  return { index: indexState.index, derived: derivedCache, indexCacheHit: indexState.cacheHit, derivedCacheHit };
}

function writeMessage(message: unknown) {
  const json = JSON.stringify(message);
  process.stdout.write(json + '\n');
}

function listTools() {
  return [
    {
      name: 'analyze_startup_flow',
      description: 'Analyze project startup definitions and their immediate outbound flow.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'analyze_project_reference_impact',
      description: 'Find which projects are affected by a matching external reference/library.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Reference/library text, GUID, or description to search.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'explain_symbol',
      description: 'Return a higher-level explanation of a symbol including likely definition, call graph context, and related modules.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact symbol name.' },
          kind: { type: 'string', description: 'Optional symbol kind filter.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_callers',
      description: 'Find routines that call a given VB6 routine.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Routine name.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_callees',
      description: 'Find routines called by a given VB6 routine.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Routine name.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'trace_flow',
      description: 'Follow a partial call flow outward from a starting routine.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Starting routine name.' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_related_symbols',
      description: 'Find symbols related by module or lightweight call-graph heuristics.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Anchor symbol name.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_state_mutations',
      description: 'Find assignment-style mutations of a variable or state symbol.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Variable or state symbol name.' },
          maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_network_entrypoints',
      description: 'List likely network-related routines in legacy VB6 projects.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'find_ui_entrypoints',
      description: 'List likely UI-related routines in legacy VB6 projects.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'trace_inbound_flow',
      description: 'Trace callers inward toward a target routine.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Target routine name.' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'trace_outbound_flow',
      description: 'Trace callees outward from a starting routine.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Starting routine name.' },
          maxDepth: { type: 'integer', minimum: 1, maximum: 6, default: 3 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'analyze_state_symbol',
      description: 'Analyze a state-like symbol with mutations and lightweight inbound/outbound flow.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Variable or state symbol name.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'analyze_symbol',
      description: 'Return a bundled symbol analysis with definition, references, call graph hints, related symbols, and mutations.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact symbol name.' },
          kind: { type: 'string', description: 'Optional symbol kind filter.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'analyze_module',
      description: 'Return a bundled module analysis with routines, controls, and notable symbols.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Filename or relative path suffix.' },
        },
        required: ['file'],
        additionalProperties: false,
      },
    },
    {
      name: 'summarize_module',
      description: 'Return an agent-oriented module summary with key routines and notable counts.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Filename or relative path suffix.' },
        },
        required: ['file'],
        additionalProperties: false,
      },
    },
    {
      name: 'analyze_packet_handler',
      description: 'Analyze a likely packet/network handler with definition and lightweight call graph context.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Handler routine name.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'analyze_ui_form',
      description: 'Analyze a form or UI-heavy file with controls and likely UI routines.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Form filename or relative path suffix.' },
        },
        required: ['file'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_projects',
      description: 'List discovered VB6 projects in the current workspace.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'reference_info',
      description: 'Search external/object project references by description, library name, or GUID.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search in description, GUID, or library name.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'find_symbol',
      description: 'Find VB6 symbol definitions by exact name in the indexed workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact symbol name to find.' },
          kind: { type: 'string', description: 'Optional symbol kind filter.' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          includeBody: { type: 'boolean', default: true, description: 'Include the source body/snippet for each definition.' },
          maxBodyLines: { type: 'integer', minimum: 1, maximum: 300, default: 120 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_symbols',
      description: 'List symbols in a file or across the workspace, optionally filtered by kind or name.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Optional filename or relative path suffix.' },
          kind: { type: 'string', description: 'Optional symbol kind filter.' },
          filter: { type: 'string', description: 'Optional name substring filter.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 60 },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'find_references',
      description: 'Find non-comment references to a VB6 symbol name across the indexed workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Symbol name to search references for.' },
          maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'search_code',
      description: 'Search raw VB6 source text, optionally limited to a relative path prefix.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for.' },
          scope: { type: 'string', description: 'Optional relative path prefix to narrow the search.' },
          maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'read_function',
      description: 'Read the complete body of a VB6 Sub/Function/Property from an indexed file.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Filename or relative path suffix, for example modDeadChecks.bas.' },
          name: { type: 'string', description: 'Routine name to read.' },
          maxBodyLines: { type: 'integer', minimum: 1, maximum: 400, default: 240 },
        },
        required: ['file', 'name'],
        additionalProperties: false,
      },
    },
    {
      name: 'signature',
      description: 'Return parsed signatures for matching VB6 symbols.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Exact symbol name.' },
          kind: { type: 'string', description: 'Optional symbol kind filter.' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    {
      name: 'module_info',
      description: 'Summarize a VB6 module and its indexed symbols.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Filename or relative path suffix.' },
        },
        required: ['file'],
        additionalProperties: false,
      },
    },
    {
      name: 'type_members',
      description: 'List known members for a VB6 class or Type by name.',
      inputSchema: {
        type: 'object',
        properties: {
          typeName: { type: 'string', description: 'Class module or Type name.' },
        },
        required: ['typeName'],
        additionalProperties: false,
      },
    },
    {
      name: 'project_info',
      description: 'Return discovered .vbp project metadata, source directories, and external references.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'index_stats',
      description: 'Return a quick summary of the current VB6 index cache.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'reindex_vb6',
      description: 'Force a full rebuild of the VB6 workspace index.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ];
}

function toolResult(data: unknown) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolError(message: string) {
  return {
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
    isError: true,
  };
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  if (name === 'analyze_startup_flow') {
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      analysis: analyzeStartupFlow(index, derived, workspaceConfig.projects),
    });
  }

  if (name === 'analyze_project_reference_impact') {
    ensureIndex();
    return toolResult({
      indexedAt,
      analysis: analyzeProjectReferenceImpact(workspaceConfig.projects, String(args.query)),
    });
  }

  if (name === 'analyze_symbol') {
    const { index, derived } = ensureDerived();
    const matches = (index.byName.get(String(args.name).toLowerCase()) || [])
      .filter((symbol) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase());
    const references = getCachedReferences(derived, index, String(args.name), findReferences, 25);
    const mutations = findStateMutations(index, String(args.name), 25);

    return toolResult({
      indexedAt,
      analysis: analyzeSymbolBundle(index, derived, String(args.name), matches, references, mutations),
    });
  }

  if (name === 'analyze_module') {
    const { index, derived } = ensureDerived();
    const fileResolution = resolveFileSymbols(index, String(args.file));
    const fileMatch = fileResolution.match;
    if (!fileMatch) {
      const hint = fileResolution.candidates.length > 0
        ? ` Candidates: ${fileResolution.candidates.join(', ')}`
        : '';
      return toolError(`File not found or ambiguous: ${String(args.file)}.${hint}`);
    }

    return toolResult({
      indexedAt,
      analysis: analyzeModuleBundle(index, derived, fileMatch.filePath, fileMatch.symbols),
    });
  }

  if (name === 'trace_inbound_flow') {
    const { derived } = ensureDerived();
    return toolResult({
      indexedAt,
      name: String(args.name),
      trace: traceInboundFlow(derived, String(args.name), Number(args.maxDepth || 3)),
    });
  }

  if (name === 'trace_outbound_flow') {
    const { derived } = ensureDerived();
    return toolResult({
      indexedAt,
      name: String(args.name),
      trace: traceOutboundFlow(derived, String(args.name), Number(args.maxDepth || 3)),
    });
  }

  if (name === 'analyze_state_symbol') {
    const { index, derived } = ensureDerived();
    const mutations = findStateMutations(index, String(args.name), 50);
    return toolResult({
      indexedAt,
      analysis: analyzeStateSymbol(index, derived, String(args.name), mutations),
    });
  }

  if (name === 'explain_symbol') {
    const { index, derived } = ensureDerived();
    const matches = (index.byName.get(String(args.name).toLowerCase()) || [])
      .filter((symbol) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase());
    const references = getCachedReferences(derived, index, String(args.name), findReferences, 25);

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: matches.length,
      matches,
      explanation: explainSymbol(index, derived, matches),
      references,
    });
  }

  if (name === 'summarize_module') {
    const { index, derived } = ensureDerived();
    const fileResolution = resolveFileSymbols(index, String(args.file));
    const fileMatch = fileResolution.match;
    if (!fileMatch) {
      const hint = fileResolution.candidates.length > 0
        ? ` Candidates: ${fileResolution.candidates.join(', ')}`
        : '';
      return toolError(`File not found or ambiguous: ${String(args.file)}.${hint}`);
    }

    return toolResult({
      indexedAt,
      summary: summarizeModuleForAgents(index, derived, fileMatch.filePath, fileMatch.symbols),
    });
  }

  if (name === 'analyze_packet_handler') {
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      analysis: analyzePacketHandler(index, derived, String(args.name)),
    });
  }

  if (name === 'analyze_ui_form') {
    const { index, derived } = ensureDerived();
    const fileResolution = resolveFileSymbols(index, String(args.file));
    const fileMatch = fileResolution.match;
    if (!fileMatch) {
      const hint = fileResolution.candidates.length > 0
        ? ` Candidates: ${fileResolution.candidates.join(', ')}`
        : '';
      return toolError(`File not found or ambiguous: ${String(args.file)}.${hint}`);
    }
    return toolResult({
      indexedAt,
      analysis: analyzeUiForm(index, derived, fileMatch.filePath, fileMatch.symbols),
    });
  }

  if (name === 'find_callers') {
    const { derived } = ensureDerived();
    return toolResult({
      indexedAt,
      name: String(args.name),
      callers: getCallers(derived, String(args.name)),
    });
  }

  if (name === 'find_callees') {
    const { derived } = ensureDerived();
    return toolResult({
      indexedAt,
      name: String(args.name),
      callees: getCallees(derived, String(args.name)),
    });
  }

  if (name === 'trace_flow') {
    const { derived } = ensureDerived();
    return toolResult({
      indexedAt,
      name: String(args.name),
      trace: traceFlow(derived, String(args.name), Number(args.maxDepth || 3)),
    });
  }

  if (name === 'find_related_symbols') {
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      name: String(args.name),
      related: findRelatedSymbols(index, derived, String(args.name)),
    });
  }

  if (name === 'find_state_mutations') {
    const { index } = ensureIndex();
    return toolResult({
      indexedAt,
      name: String(args.name),
      mutations: findStateMutations(index, String(args.name), Number(args.maxResults || 50)),
    });
  }

  if (name === 'find_network_entrypoints') {
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      entrypoints: findEntrypointsCached(index, derived, 'network'),
    });
  }

  if (name === 'find_ui_entrypoints') {
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      entrypoints: findEntrypointsCached(index, derived, 'ui'),
    });
  }

  if (name === 'list_projects') {
    ensureIndex();
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: workspaceConfig.projects.length,
      projects: workspaceConfig.projects.map((project) => ({
        file: project.file,
        name: project.name,
        type: project.type,
        componentCount: project.components.length,
        referenceCount: project.references.length,
        objectCount: project.objects.length,
      })),
    });
  }

  if (name === 'reference_info') {
    ensureIndex();
    const query = String(args.query).toLowerCase();
    const matches = [...workspaceConfig.externalReferences, ...workspaceConfig.objectReferences]
      .filter((reference) =>
        reference.raw.toLowerCase().includes(query) ||
        (reference.description || '').toLowerCase().includes(query) ||
        (reference.guid || '').toLowerCase().includes(query) ||
        (reference.libraryName || '').toLowerCase().includes(query),
      );

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: matches.length,
      matches,
    });
  }

  if (name === 'find_symbol') {
    const { index } = ensureIndex();
    const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);
    const includeBody = args.includeBody !== false;
    const maxBodyLines = Math.min(Math.max(Number(args.maxBodyLines || 120), 1), 300);
    const matches = (index.byName.get(String(args.name).toLowerCase()) || [])
      .filter((symbol: any) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase())
      .slice(0, limit)
      .map((symbol: any) => ({
        ...symbol,
        parsedSignature: formatSignature(symbol),
        body: includeBody ? readSymbolBody(index, symbol, maxBodyLines) : undefined,
      }));

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: matches.length,
      matches,
    });
  }

  if (name === 'list_symbols') {
    const { index } = ensureIndex();
    const limit = Math.min(Math.max(Number(args.limit || 60), 1), 200);
    const kindFilter = args.kind ? String(args.kind).toLowerCase() : '';
    const nameFilter = args.filter ? String(args.filter).toLowerCase() : '';

      let symbols = index.symbols;
      let resolvedFile: string | undefined;
      if (args.file) {
      const fileResolution = resolveFileSymbols(index, String(args.file));
      const fileMatch = fileResolution.match;
        if (!fileMatch) {
          const hint = fileResolution.candidates.length > 0
            ? ` Candidates: ${fileResolution.candidates.join(', ')}`
            : '';
          return toolError(`File not found or ambiguous: ${String(args.file)}.${hint}`);
        }
        resolvedFile = fileMatch.filePath;
        symbols = fileMatch.symbols;
    }

    const matches = symbols
      .filter((symbol: any) => !kindFilter || symbol.kind.toLowerCase() === kindFilter)
      .filter((symbol: any) => !nameFilter || symbol.name.toLowerCase().includes(nameFilter))
      .slice(0, limit)
      .map((symbol: any) => ({
        file: symbol.file,
        moduleName: symbol.moduleName,
        name: symbol.name,
        kind: symbol.kind,
        visibility: symbol.visibility,
        line: symbol.line,
        endLine: symbol.endLine,
        signature: formatSignature(symbol),
      }));

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      file: resolvedFile,
      count: matches.length,
      matches,
    });
  }

  if (name === 'find_references') {
    const { index } = ensureIndex();
    const maxResults = Math.min(Math.max(Number(args.maxResults || 30), 1), 200);
    const references = findReferences(index, String(args.name), maxResults);
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: references.length,
      references,
    });
  }

  if (name === 'search_code') {
    const { index } = ensureIndex();
    const maxResults = Math.min(Math.max(Number(args.maxResults || 30), 1), 200);
    const results = searchCode(index, String(args.query), {
      scope: args.scope ? String(args.scope) : undefined,
      maxResults,
    });
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: results.length,
      results,
    });
  }

  if (name === 'read_function') {
    const { index } = ensureIndex();
    const maxBodyLines = Math.min(Math.max(Number(args.maxBodyLines || 240), 1), 400);
    const fileResolution = resolveFileSymbols(index, String(args.file));
    const fileMatch = fileResolution.match;
    if (!fileMatch) {
      const hint = fileResolution.candidates.length > 0
        ? ` Candidates: ${fileResolution.candidates.join(', ')}`
        : '';
      return toolError(`File not found or ambiguous: ${String(args.file)}.${hint}`);
    }

    const symbol = fileMatch.symbols.find((entry) =>
      entry.name.toLowerCase() === String(args.name).toLowerCase() &&
      (entry.kind === 'Sub' || entry.kind === 'Function' || entry.kind === 'Property' || entry.kind === 'Declare'),
    );
    if (!symbol) {
      return toolError(`Routine "${String(args.name)}" not found in ${fileMatch.filePath}`);
    }

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      file: fileMatch.filePath,
      symbol: {
        ...symbol,
        parsedSignature: formatSignature(symbol),
      },
      body: readSymbolBody(index, symbol, maxBodyLines),
    });
  }

  if (name === 'signature') {
    const { index } = ensureIndex();
    const matches = (index.byName.get(String(args.name).toLowerCase()) || [])
      .filter((symbol: any) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase())
      .map((symbol: any) => ({
        file: symbol.file,
        moduleName: symbol.moduleName,
        name: symbol.name,
        kind: symbol.kind,
        visibility: symbol.visibility,
        line: symbol.line,
        signature: formatSignature(symbol),
        rawSignature: symbol.signature,
        params: symbol.params,
        returnType: symbol.returnType,
      }));

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: matches.length,
      matches,
    });
  }

  if (name === 'module_info') {
    const { index } = ensureIndex();
    const fileResolution = resolveFileSymbols(index, String(args.file));
    const fileMatch = fileResolution.match;
    if (!fileMatch) {
      const hint = fileResolution.candidates.length > 0
        ? ` Candidates: ${fileResolution.candidates.join(', ')}`
        : '';
      return toolError(`File not found or ambiguous: ${String(args.file)}.${hint}`);
    }

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      ...summarizeModule(index, fileMatch.filePath, fileMatch.symbols),
    });
  }

  if (name === 'type_members') {
    const { index } = ensureIndex();
    const typeName = String(args.typeName).toLowerCase();
    const matches = index.symbols.filter((symbol) =>
      (symbol.scope === 'member' && symbol.containerName?.toLowerCase() === typeName) ||
      (symbol.scope === 'module' && symbol.moduleName.toLowerCase() === typeName && symbol.kind !== 'Type' && symbol.kind !== 'Enum' && symbol.kind !== 'Implements'),
    );

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      typeName: String(args.typeName),
      count: matches.length,
      matches: matches.map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        file: symbol.file,
        signature: formatSignature(symbol),
        returnType: symbol.returnType,
      })),
    });
  }

  if (name === 'project_info') {
    ensureIndex();
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      projectFiles: workspaceConfig.projectFiles,
      sourceDirs: workspaceConfig.sourceDirs,
      projects: workspaceConfig.projects,
      externalReferences: workspaceConfig.externalReferences,
      objectReferences: workspaceConfig.objectReferences,
      indexedAt,
    });
  }

  if (name === 'index_stats') {
    const { index } = ensureIndex();
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      projectFiles: workspaceConfig.projectFiles,
      sourceDirs: workspaceConfig.sourceDirs,
      projectCount: workspaceConfig.projects.length,
      externalReferenceCount: workspaceConfig.externalReferences.length,
      indexedAt,
      files: index.files.length,
      symbols: index.symbols.length,
    });
  }

  if (name === 'reindex_vb6') {
    const { index } = ensureIndex(true);
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      projectFiles: workspaceConfig.projectFiles,
      sourceDirs: workspaceConfig.sourceDirs,
      indexedAt,
      files: index.files.length,
      symbols: index.symbols.length,
      rebuilt: true,
    });
  }

  return toolError(`Unknown tool: ${name}`);
}

async function handleMessage(message: any) {
  try {
    if (message.method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'vb6-lsp-mcp',
            version: '3.3.2',
          },
        },
      });
      return;
    }

    if (message.method === 'notifications/initialized') {
      return;
    }

    if (message.method === 'tools/list') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: listTools(),
        },
      });
      return;
    }

    if (message.method === 'tools/call') {
      const toolName = String(message.params?.name || '');
      const started = Date.now();
      const hadIndex = Boolean(cachedIndex);
      const hadDerived = Boolean(derivedCache);
      const result = await callTool(toolName, message.params?.arguments || {});
      const telemetrySummary = summarizeToolResult(result);
      recordTelemetry(telemetry, {
        ts: new Date().toISOString(),
        workspace_id: telemetry.workspaceId,
        tool_name: toolName,
        duration_ms: Date.now() - started,
        result_count: telemetrySummary.resultCount,
        output_chars: telemetrySummary.outputChars,
        index_cache_hit: hadIndex,
        derived_cache_hit: hadDerived,
        error: null,
      });
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result,
      });
      return;
    }

    if (typeof message.id !== 'undefined') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`,
        },
      });
    }
  } catch (error) {
    if (message.method === 'tools/call') {
      recordTelemetry(telemetry, {
        ts: new Date().toISOString(),
        workspace_id: telemetry.workspaceId,
        tool_name: String(message.params?.name || ''),
        duration_ms: 0,
        result_count: null,
        output_chars: 0,
        index_cache_hit: Boolean(cachedIndex),
        derived_cache_hit: Boolean(derivedCache),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (typeof message.id !== 'undefined') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32000,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

let buffer = '';

function drainBuffer() {
  const lines = buffer.split('\n');
  buffer = lines.pop()!;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    void handleMessage(JSON.parse(trimmed));
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  drainBuffer();
});

process.stdin.on('end', () => {
  process.exit(0);
});
