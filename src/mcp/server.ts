import { Buffer } from 'node:buffer';
import * as fs from 'fs';
import * as path from 'path';
import { buildVB6Index, findReferences, indexSnapshotChanged, searchCodeSmart } from '../server/indexer/mcp-bridge';
import { resolveWorkspaceConfig, VB6ServerSettings } from '../server/config';
import { FileResolution, findFileSymbols, formatSignature, readSymbolBody, resolveFileSymbols, summarizeModule } from './utils';
import { analyzeModuleBundle, analyzePacketHandler, analyzeProjectReferenceImpact, analyzeStartupFlow, analyzeStateSymbol, analyzeSymbolBundle, analyzeUiForm, buildDerivedCache, DerivedCache, explainSymbol, findEntrypointsCached, findRelatedSymbols, findStateMutations, getCachedReferences, getCallees, getCallers, summarizeModuleForAgents, traceFlow, traceInboundFlow, traceOutboundFlow } from './analysis';
import { TelemetryCacheState, captureRawInputs, createTelemetryContext, createTelemetryEvent, recordTelemetry, summarizeToolArguments, summarizeToolResult } from './telemetry';
import { isSupportedVB6Source, isVB6ComponentFile, stripVB6ComponentExtension } from '../shared/components';
import { inspectFrxReference } from './frx';
import { inspectResFile } from './res';

const SERVER_VERSION = '3.4.0';

const workspaceConfig = resolveWorkspaceConfig({
  rootUri: process.env.VB6_LSP_ROOT ? `file:///${process.env.VB6_LSP_ROOT.replace(/\\/g, '/')}` : undefined,
  settings: extractSettingsFromEnv(),
});

let cachedIndex: ReturnType<typeof buildVB6Index> | null = null;
let indexedAt: string | null = null;
let derivedCache: DerivedCache | null = null;
const telemetry = createTelemetryContext(workspaceConfig.rootDir, SERVER_VERSION);
const INDEX_CACHE_TOOLS = new Set([
  'analyze_startup_flow',
  'analyze_project_reference_impact',
  'analyze_symbol',
  'analyze_module',
  'trace_inbound_flow',
  'trace_outbound_flow',
  'analyze_state_symbol',
  'explain_symbol',
  'summarize_module',
  'analyze_packet_handler',
  'analyze_ui_form',
  'find_callers',
  'find_callees',
  'trace_flow',
  'find_related_symbols',
  'find_state_mutations',
  'find_network_entrypoints',
  'find_ui_entrypoints',
  'list_projects',
  'reference_info',
  'find_symbol',
  'list_symbols',
  'find_references',
  'search_code',
  'read_function',
  'signature',
  'module_info',
  'type_members',
  'project_info',
  'reindex_vb6',
  'batch_search_code',
  'batch_read_function',
  'inspect_frx',
]);
const DERIVED_CACHE_TOOLS = new Set([
  'analyze_startup_flow',
  'analyze_symbol',
  'analyze_module',
  'trace_inbound_flow',
  'trace_outbound_flow',
  'analyze_state_symbol',
  'explain_symbol',
  'summarize_module',
  'analyze_packet_handler',
  'analyze_ui_form',
  'find_callers',
  'find_callees',
  'trace_flow',
  'find_related_symbols',
  'find_network_entrypoints',
  'find_ui_entrypoints',
]);

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

const FRESHNESS_CHECK_INTERVAL_MS = readEnvMs('VB6_LSP_FRESHNESS_INTERVAL_MS', 60000);
let lastFreshnessCheck = 0;

function readEnvMs(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function ensureIndex(force = false) {
  let stale = false;
  if (cachedIndex && !force) {
    const now = Date.now();
    if (now - lastFreshnessCheck >= FRESHNESS_CHECK_INTERVAL_MS) {
      lastFreshnessCheck = now;
      stale = indexSnapshotChanged(cachedIndex, workspaceConfig.rootDir, workspaceConfig.sourceDirs);
      if (stale) console.error('[vb6-index] Source files changed on disk; rebuilding index.');
    }
  }
  const cacheHit = Boolean(cachedIndex) && !force && !stale;
  if (!cachedIndex || force || stale) {
    cachedIndex = buildVB6Index(workspaceConfig.rootDir, workspaceConfig.sourceDirs);
    indexedAt = new Date().toISOString();
    derivedCache = null;
    lastFreshnessCheck = Date.now();
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

function cacheStateForTool(toolName: string, hadCache: boolean, eligibleTools: Set<string>): TelemetryCacheState {
  if (!eligibleTools.has(toolName)) return 'na';
  if (toolName === 'reindex_vb6') return 'miss';
  return hadCache ? 'hit' : 'miss';
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
      description: 'Find VB6 symbol definitions by name, returning suggestions when no exact match exists.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Symbol name to find.' },
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
          offset: { type: 'integer', minimum: 0, default: 0 },
          compact: { type: 'boolean', default: false, description: 'Return a compact shape with fewer fields.' },
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
      description: 'Search VB6 source text and indexed symbols, optionally limited to a path scope (prefix, dir fragment, or filename). Falls back to all-tokens-on-one-line matching and relaxes the scope when nothing matches; check search_meta for which stage hit.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for. Multi-word queries also match lines containing all words in any order.' },
          scope: { type: 'string', description: 'Optional path filter: prefix ("Server"), dir fragment ("Server/source"), or filename ("modUIMapa.bas").' },
          maxResults: { type: 'integer', minimum: 1, maximum: 200, default: 30 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      name: 'read_function',
      description: 'Read the complete body of a VB6 Sub/Function/Property. File is optional when the routine name is unique. Accepts "Module.Routine" names, auto-disambiguates duplicate filenames, and serves the unique global definition when the file hint is wrong.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Optional filename or relative path suffix, for example modDeadChecks.bas.' },
          name: { type: 'string', description: 'Routine name to read. "Module.Routine" also works.' },
          maxBodyLines: { type: 'integer', minimum: 1, maximum: 400, default: 240 },
        },
        required: ['name'],
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
    {
      name: 'batch_search_code',
      description: 'Search multiple patterns in one call. Returns results grouped by query.',
      inputSchema: {
        type: 'object',
        properties: {
          queries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Text to search for.' },
                scope: { type: 'string', description: 'Optional relative path prefix.' },
                maxResults: { type: 'integer', minimum: 1, maximum: 100, default: 15 },
              },
              required: ['query'],
              additionalProperties: false,
            },
            minItems: 1,
            maxItems: 10,
            description: 'Array of search queries (max 10).',
          },
        },
        required: ['queries'],
        additionalProperties: false,
      },
    },
    {
      name: 'batch_read_function',
      description: 'Read multiple VB6 routines in one call. Returns bodies grouped by file+name.',
      inputSchema: {
        type: 'object',
        properties: {
          functions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                file: { type: 'string', description: 'Filename or relative path suffix.' },
                name: { type: 'string', description: 'Routine name to read.' },
                maxBodyLines: { type: 'integer', minimum: 1, maximum: 400, default: 240 },
              },
              required: ['file', 'name'],
              additionalProperties: false,
            },
            minItems: 1,
            maxItems: 10,
            description: 'Array of file+name pairs (max 10).',
          },
        },
        required: ['functions'],
        additionalProperties: false,
      },
    },
    {
      name: 'inspect_frx',
      description: 'Inspect one read-only VB6 .frx/.ctx companion reference from a .frm or .ctl file. Decodes bounded short/medium/long text, font, picture, and list records; unsupported control bags remain opaque.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Form or UserControl filename or relative path containing the reference.' },
          value: { type: 'string', description: 'Raw VB6 reference value, for example "Form1.frx":0000 or $"Form1.frx":0004.' },
          property: { type: 'string', description: 'Optional designer property name such as Caption, Picture, Font, or List.' },
          kind: { type: 'string', enum: ['picture', 'font', 'string_short', 'string_medium', 'string_long', 'list', 'opaque'], description: 'Optional explicit decoder when the property name is vendor-specific.' },
          previewBytes: { type: 'integer', minimum: 0, maximum: 256, default: 64, description: 'Maximum picture/opaque preview bytes returned as hex.' },
        },
        required: ['file', 'value'],
        additionalProperties: false,
      },
    },
    {
      name: 'inspect_res',
      description: 'Inspect a Windows .res file read-only. Returns bounded entry metadata and extracts standard RT_STRING table values; resource bytes are never written or returned in full.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Workspace-relative .res file path.' },
          previewBytes: { type: 'integer', minimum: 0, maximum: 256, default: 64, description: 'Maximum bytes per resource preview, returned as hex.' },
        },
        required: ['file'],
        additionalProperties: false,
      },
    },
  ];
}

const MAX_OUTPUT_CHARS = 30000;

type ToolErrorKind = 'invalid_args' | 'ambiguous_file' | 'not_found' | 'internal_error' | 'unknown_tool';

function toolResult(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  if (text.length > MAX_OUTPUT_CHARS) {
    text = JSON.stringify({
      truncated: true,
      output_chars_before_truncation: text.length,
      limit: MAX_OUTPUT_CHARS,
      preview: text.slice(0, MAX_OUTPUT_CHARS),
    }, null, 2);
  }
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

function toolError(
  message: string,
  errorKind: ToolErrorKind = 'internal_error',
  details: Record<string, unknown> = {},
) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          error: true,
          error_kind: errorKind,
          recoverable: errorKind !== 'internal_error',
          message,
          ...details,
        }, null, 2),
      },
    ],
    isError: true,
  };
}

function paginate<T>(items: T[], args: Record<string, unknown>, defaultLimit = 60, maxLimit = 200): {
  items: T[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
  nextOffset: number | null;
} {
  const limit = Math.min(Math.max(Number(args.limit || args.maxResults || defaultLimit), 1), maxLimit);
  const offset = Math.min(Math.max(Number(args.offset || 0), 0), items.length);
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length < items.length ? offset + page.length : null;
  return {
    items: page,
    limit,
    offset,
    total: items.length,
    hasMore: nextOffset !== null,
    nextOffset,
  };
}

function formatFileCandidates(candidates: string[]) {
  return candidates.map((file) => ({
    file,
    project: workspaceConfig.projects.find((project) =>
      project.components.some((component) => component.path.replace(/\\/g, '/').endsWith(file)),
    )?.name,
  }));
}

function invalidMissingArg(name: string) {
  return toolError(`Missing required argument: ${name}`, 'invalid_args', {
    missing_argument: name,
  });
}

function fileResolutionError(file: string, candidates: string[]) {
  if (candidates.length > 0) {
    return toolError(`File not found or ambiguous: ${file}`, 'ambiguous_file', {
      file,
      candidate_count: candidates.length,
      candidates: formatFileCandidates(candidates.slice(0, 10)),
      hint: 'Pass the exact relative path or include a project/source directory prefix.',
    });
  }
  return toolError(`File not found: ${file}`, 'not_found', { file });
}

function routineSymbols(index: ReturnType<typeof buildVB6Index>, name: string, kind?: unknown) {
  return (index.byName.get(name.toLowerCase()) || [])
    .filter((symbol) => isRoutineSymbol(symbol))
    .filter((symbol) => !kind || symbol.kind.toLowerCase() === String(kind).toLowerCase());
}

function isRoutineSymbol(symbol: { kind: string }) {
  return symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property' || symbol.kind === 'Declare';
}

function symbolSuggestions(index: ReturnType<typeof buildVB6Index>, name: string, limit = 10, kind?: unknown) {
  const normalized = normalizeIdentifier(name);
  const lower = name.toLowerCase();
  return index.symbols
    .filter((symbol) => !kind || symbol.kind.toLowerCase() === String(kind).toLowerCase())
    .map((symbol) => {
      const symbolLower = symbol.name.toLowerCase();
      const symbolNormalized = normalizeIdentifier(symbol.name);
      let score = 0;
      if (symbolLower === lower) score = 100;
      else if (symbolNormalized === normalized) score = 95;
      else if (symbolLower.startsWith(lower)) score = 80;
      else if (normalized && symbolNormalized.startsWith(normalized)) score = 75;
      else if (symbolLower.includes(lower)) score = 60;
      else if (normalized && symbolNormalized.includes(normalized)) score = 55;
      return { symbol, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ symbol, score }) => ({
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      moduleName: symbol.moduleName,
      line: symbol.line,
      signature: formatSignature(symbol),
      score,
    }));
}

function normalizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Read the first non-empty string among several accepted argument spellings.
 * Agents frequently pass `symbol` for `name`, `path` for `file`, etc. — accept them.
 */
function argString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function invalidMissingArgWithAliases(name: string, aliases: string[]) {
  return toolError(`Missing required argument: ${name}`, 'invalid_args', {
    missing_argument: name,
    accepted_aliases: aliases,
  });
}

/**
 * Normalize a symbol-name argument: strips trailing "()" and call decoration,
 * and splits "Module.Proc" into a module hint + bare name.
 */
function parseSymbolName(value: string): { name: string; moduleHint?: string } {
  const cleaned = value.trim().replace(/\(\s*\)\s*$/, '').trim();
  // A filename is not a qualified symbol — never split "modFoo.bas" into routine "bas".
  if (isVB6ComponentFile(cleaned)) {
    return { name: cleaned };
  }
  const segments = cleaned.split('.');
  if (segments.length >= 2 && segments.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment))) {
    return {
      name: segments[segments.length - 1],
      moduleHint: segments[segments.length - 2],
    };
  }
  return { name: cleaned };
}

/** Workspace-relative versions of the explicitly configured source dirs, for ranking ambiguous files. */
const preferredDirs = workspaceConfig.configuredSourceDirs
  .map((dir) => path.relative(workspaceConfig.rootDir, dir).replace(/\\/g, '/'))
  .filter((dir) => dir.length > 0 && !dir.startsWith('..'));

/**
 * True when the named source file exists on disk even though the index missed it —
 * the signal that the in-memory index is stale (file created after indexing).
 */
function fileProbablyOnDisk(fileArg: string): boolean {
  const cleaned = fileArg.replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!isSupportedVB6Source(cleaned)) return false;
  const probes: string[] = [];
  if (cleaned.includes('/')) {
    // Only probe paths a reindex could actually pick up — a file outside every
    // indexed source dir would trigger a provably useless rebuild.
    const absolute = path.resolve(workspaceConfig.rootDir, cleaned);
    const underIndexedDir = workspaceConfig.sourceDirs.some((dir) => {
      const dirResolved = path.resolve(dir).toLowerCase();
      return absolute.toLowerCase().startsWith(dirResolved + path.sep) || absolute.toLowerCase() === dirResolved;
    });
    if (!underIndexedDir) return false;
    probes.push(absolute);
  } else {
    for (const dir of workspaceConfig.sourceDirs) {
      probes.push(path.join(dir, cleaned));
    }
  }
  return probes.some((probe) => {
    try { return fs.existsSync(probe); } catch { return false; }
  });
}

/**
 * File resolution with preference ranking and a one-shot stale-index retry:
 * if nothing matches but the file exists on disk, force a reindex and try again.
 */
const PROBE_REINDEX_COOLDOWN_MS = readEnvMs('VB6_LSP_PROBE_COOLDOWN_MS', 30000);
let lastProbeReindexAt = 0;

function resolveFileSmart(fileArg: string, routineName?: string): {
  index: ReturnType<typeof buildVB6Index>;
  resolution: FileResolution;
} {
  let { index } = ensureIndex();
  let resolution = resolveFileSymbols(index, fileArg, { preferDirs: preferredDirs, routineName });
  if (
    !resolution.match &&
    resolution.candidates.length === 0 &&
    Date.now() - lastProbeReindexAt >= PROBE_REINDEX_COOLDOWN_MS &&
    fileProbablyOnDisk(fileArg)
  ) {
    // The file exists on disk but the index missed it — rebuild once, with a
    // cooldown so a file that stays unindexable (outside all source dirs)
    // cannot trigger a rebuild per call.
    lastProbeReindexAt = Date.now();
    ({ index } = ensureIndex(true));
    resolution = resolveFileSymbols(index, fileArg, { preferDirs: preferredDirs, routineName });
  }
  return { index, resolution };
}

function routineOnlySuggestions(index: ReturnType<typeof buildVB6Index>, name: string, limit = 10) {
  return symbolSuggestions(index, name, limit)
    .filter((candidate) => candidate.kind === 'Sub' || candidate.kind === 'Function' || candidate.kind === 'Property' || candidate.kind === 'Declare');
}

/**
 * Shared extras for call-graph tools: when the routine is unknown to the index,
 * say so and offer near-matches instead of a silent empty list.
 */
function callGraphExtras(derived: DerivedCache, name: string, resultCount: number) {
  const known = derived.routineNames.has(name.toLowerCase());
  if (known && resultCount > 0) return {};
  const { index } = ensureIndex();
  return {
    known_routine: known,
    ...(known ? {} : { suggestions: routineOnlySuggestions(index, name, 8) }),
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
    const query = argString(args, ['query', 'text', 'pattern', 'name']);
    if (!query) return invalidMissingArgWithAliases('query', ['text', 'pattern', 'name']);
    return toolResult({
      indexedAt,
      indexed: Boolean(cachedIndex),
      analysis: analyzeProjectReferenceImpact(workspaceConfig.projects, query),
    });
  }

  if (name === 'analyze_symbol') {
    const rawName = argString(args, ['name', 'symbol', 'routine']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine']);
    const symbolName = parseSymbolName(rawName).name;
    const { index, derived } = ensureDerived();
    const matches = (index.byName.get(symbolName.toLowerCase()) || [])
      .filter((symbol) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase());
    const references = getCachedReferences(derived, index, symbolName, findReferences, 25);
    const mutations = findStateMutations(index, symbolName, 25);

    return toolResult({
      indexedAt,
      ...(matches.length === 0 ? { suggestions: symbolSuggestions(index, symbolName, 8) } : {}),
      analysis: analyzeSymbolBundle(index, derived, symbolName, matches, references, mutations),
    });
  }

  if (name === 'analyze_module') {
    if (!argString(args, ['file', 'path', 'module', 'filename'])) return invalidMissingArgWithAliases('file', ['path', 'module', 'filename']);
    const fileArg = argString(args, ['file', 'path', 'module', 'filename'])!;
    const { resolution } = resolveFileSmart(fileArg);
    if (!resolution.match) {
      return fileResolutionError(fileArg, resolution.candidates);
    }
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      ...(resolution.resolution ? { resolution_note: `'${fileArg}' resolved to ${resolution.match.filePath} (${resolution.resolution})`, alternates: resolution.candidates } : {}),
      analysis: analyzeModuleBundle(index, derived, resolution.match.filePath, resolution.match.symbols),
    });
  }

  if (name === 'trace_inbound_flow') {
    const rawName = argString(args, ['name', 'symbol', 'routine', 'function']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine', 'function']);
    const symbolName = parseSymbolName(rawName).name;
    const { derived } = ensureDerived();
    const trace = traceInboundFlow(derived, symbolName, Number(args.maxDepth || 3));
    return toolResult({
      indexedAt,
      name: symbolName,
      trace,
      ...callGraphExtras(derived, symbolName, trace.length),
    });
  }

  if (name === 'trace_outbound_flow') {
    const rawName = argString(args, ['name', 'symbol', 'routine', 'function']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine', 'function']);
    const symbolName = parseSymbolName(rawName).name;
    const { derived } = ensureDerived();
    const trace = traceOutboundFlow(derived, symbolName, Number(args.maxDepth || 3));
    return toolResult({
      indexedAt,
      name: symbolName,
      trace,
      ...callGraphExtras(derived, symbolName, trace.length),
    });
  }

  if (name === 'analyze_state_symbol') {
    const rawName = argString(args, ['name', 'symbol', 'variable']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'variable']);
    const symbolName = parseSymbolName(rawName).name;
    const { index, derived } = ensureDerived();
    const mutations = findStateMutations(index, symbolName, 50);
    return toolResult({
      indexedAt,
      analysis: analyzeStateSymbol(index, derived, symbolName, mutations),
    });
  }

  if (name === 'explain_symbol') {
    const rawName = argString(args, ['name', 'symbol', 'routine']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine']);
    const symbolName = parseSymbolName(rawName).name;
    const { index, derived } = ensureDerived();
    const matches = (index.byName.get(symbolName.toLowerCase()) || [])
      .filter((symbol) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase());
    const references = getCachedReferences(derived, index, symbolName, findReferences, 25);

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: matches.length,
      ...(matches.length === 0 ? { suggestions: symbolSuggestions(index, symbolName, 8) } : {}),
      matches,
      explanation: explainSymbol(index, derived, matches),
      references,
    });
  }

  if (name === 'summarize_module') {
    const fileArg = argString(args, ['file', 'path', 'module', 'filename']);
    if (!fileArg) return invalidMissingArgWithAliases('file', ['path', 'module', 'filename']);
    const { resolution } = resolveFileSmart(fileArg);
    if (!resolution.match) {
      return fileResolutionError(fileArg, resolution.candidates);
    }
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      ...(resolution.resolution ? { resolution_note: `'${fileArg}' resolved to ${resolution.match.filePath} (${resolution.resolution})`, alternates: resolution.candidates } : {}),
      summary: summarizeModuleForAgents(index, derived, resolution.match.filePath, resolution.match.symbols),
    });
  }

  if (name === 'analyze_packet_handler') {
    const rawName = argString(args, ['name', 'symbol', 'handler', 'routine']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'handler', 'routine']);
    const symbolName = parseSymbolName(rawName).name;
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      analysis: analyzePacketHandler(index, derived, symbolName),
    });
  }

  if (name === 'analyze_ui_form') {
    const fileArg = argString(args, ['file', 'path', 'module', 'filename', 'form']);
    if (!fileArg) return invalidMissingArgWithAliases('file', ['path', 'module', 'filename', 'form']);
    const { resolution } = resolveFileSmart(fileArg);
    if (!resolution.match) {
      return fileResolutionError(fileArg, resolution.candidates);
    }
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      ...(resolution.resolution ? { resolution_note: `'${fileArg}' resolved to ${resolution.match.filePath} (${resolution.resolution})`, alternates: resolution.candidates } : {}),
      analysis: analyzeUiForm(index, derived, resolution.match.filePath, resolution.match.symbols),
    });
  }

  if (name === 'find_callers') {
    const rawName = argString(args, ['name', 'symbol', 'routine', 'function']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine', 'function']);
    const symbolName = parseSymbolName(rawName).name;
    const { derived } = ensureDerived();
    const callers = getCallers(derived, symbolName);
    return toolResult({
      indexedAt,
      name: symbolName,
      callers,
      ...callGraphExtras(derived, symbolName, callers.length),
    });
  }

  if (name === 'find_callees') {
    const rawName = argString(args, ['name', 'symbol', 'routine', 'function']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine', 'function']);
    const symbolName = parseSymbolName(rawName).name;
    const { derived } = ensureDerived();
    const callees = getCallees(derived, symbolName);
    return toolResult({
      indexedAt,
      name: symbolName,
      callees,
      ...callGraphExtras(derived, symbolName, callees.length),
    });
  }

  if (name === 'trace_flow') {
    const rawName = argString(args, ['name', 'symbol', 'routine', 'function']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine', 'function']);
    const symbolName = parseSymbolName(rawName).name;
    const { derived } = ensureDerived();
    const trace = traceFlow(derived, symbolName, Number(args.maxDepth || 3));
    return toolResult({
      indexedAt,
      name: symbolName,
      trace,
      ...callGraphExtras(derived, symbolName, trace.length),
    });
  }

  if (name === 'find_related_symbols') {
    const rawName = argString(args, ['name', 'symbol', 'routine']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine']);
    const symbolName = parseSymbolName(rawName).name;
    const { index, derived } = ensureDerived();
    return toolResult({
      indexedAt,
      name: symbolName,
      related: findRelatedSymbols(index, derived, symbolName),
    });
  }

  if (name === 'find_state_mutations') {
    const rawName = argString(args, ['name', 'symbol', 'variable']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'variable']);
    const symbolName = parseSymbolName(rawName).name;
    const { index } = ensureIndex();
    const mutations = findStateMutations(index, symbolName, Number(args.maxResults || 50));
    return toolResult({
      indexedAt,
      name: symbolName,
      mutations,
      ...(mutations.length === 0 ? { suggestions: symbolSuggestions(index, symbolName, 8) } : {}),
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
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      indexed: Boolean(cachedIndex),
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
    const rawQuery = argString(args, ['query', 'text', 'name', 'library']);
    if (!rawQuery) return invalidMissingArgWithAliases('query', ['text', 'name', 'library']);
    const query = rawQuery.toLowerCase();
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
      indexed: Boolean(cachedIndex),
      count: matches.length,
      matches,
    });
  }

  if (name === 'find_symbol') {
    const rawName = argString(args, ['name', 'symbol', 'query', 'routine']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'query', 'routine']);
    const parsed = parseSymbolName(rawName);
    const { index } = ensureIndex();
    const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);
    const includeBody = args.includeBody !== false;
    const maxBodyLines = Math.min(Math.max(Number(args.maxBodyLines || 120), 1), 300);
    let exactMatches = (index.byName.get(parsed.name.toLowerCase()) || [])
      .filter((symbol: any) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase());
    let moduleNote: string | undefined;
    if (parsed.moduleHint && exactMatches.length > 0) {
      const hintLower = parsed.moduleHint.toLowerCase();
      const matchesHint = (symbol: any) =>
        symbol.moduleName.toLowerCase() === hintLower ||
        stripVB6ComponentExtension(symbol.file.toLowerCase().split('/').pop() || '') === hintLower;
      const inModule = exactMatches.filter(matchesHint);
      if (inModule.length > 0 && inModule.length < exactMatches.length) {
        exactMatches = inModule;
        moduleNote = `Filtered to module '${parsed.moduleHint}' from qualified name.`;
      } else if (inModule.length === 0) {
        moduleNote = `Note: no definition lives in module '${parsed.moduleHint}'; showing matches from other modules.`;
      }
    }
    exactMatches = exactMatches.slice(0, limit);
    const suggestions = exactMatches.length === 0 ? symbolSuggestions(index, parsed.name, 10, args.kind) : [];
    const matches = exactMatches
      .map((symbol: any) => ({
        ...symbol,
        parsedSignature: formatSignature(symbol),
        body: includeBody ? readSymbolBody(index, symbol, maxBodyLines) : undefined,
      }));

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: matches.length,
      exact: matches.length > 0,
      ...(moduleNote ? { resolution_note: moduleNote } : {}),
      suggestions,
      matches,
    });
  }

  if (name === 'list_symbols') {
    const { index } = ensureIndex();
    const kindFilter = args.kind ? String(args.kind).toLowerCase() : '';
    const nameFilter = args.filter ? String(args.filter).toLowerCase() : '';
    const compact = args.compact === true;

    let symbols = index.symbols;
    let resolvedFile: string | undefined;
    const fileArg = argString(args, ['file', 'path', 'module', 'filename']);
    if (fileArg) {
      const { resolution } = resolveFileSmart(fileArg);
      if (!resolution.match) {
        return fileResolutionError(fileArg, resolution.candidates);
      }
      resolvedFile = resolution.match.filePath;
      symbols = resolution.match.symbols;
    }

    const normalizedFilter = nameFilter ? nameFilter.replace(/[^a-z0-9]/g, '') : '';
    const filtered = symbols
      .filter((symbol: any) => !kindFilter || symbol.kind.toLowerCase() === kindFilter)
      .filter((symbol: any) => {
        if (!nameFilter) return true;
        if (symbol.name.toLowerCase().includes(nameFilter)) return true;
        // Separator-insensitive fallback: "uimapa render" still matches Mapa_Render in modUIMapa.
        return normalizedFilter.length > 0 && normalizeIdentifier(symbol.name).includes(normalizedFilter);
      });
    const page = paginate(filtered, args, 60, 200);
    const matches = page.items
      .map((symbol: any) => ({
        name: symbol.name,
        kind: symbol.kind,
        file: symbol.file,
        line: symbol.line,
        ...(compact ? {} : {
          moduleName: symbol.moduleName,
          visibility: symbol.visibility,
          endLine: symbol.endLine,
          signature: formatSignature(symbol),
        }),
      }));

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      file: resolvedFile,
      count: matches.length,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
      matches,
    });
  }

  if (name === 'find_references') {
    const rawName = argString(args, ['name', 'symbol', 'query', 'routine']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'query', 'routine']);
    const symbolName = parseSymbolName(rawName).name;
    const { index } = ensureIndex();
    const maxResults = Math.min(Math.max(Number(args.maxResults || 30), 1), 200);
    const references = findReferences(index, symbolName, maxResults);
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: references.length,
      ...(references.length === 0 ? { suggestions: symbolSuggestions(index, symbolName, 8) } : {}),
      references,
    });
  }

  if (name === 'search_code') {
    const query = argString(args, ['query', 'text', 'pattern', 'q']);
    if (!query) return invalidMissingArgWithAliases('query', ['text', 'pattern', 'q']);
    const { index } = ensureIndex();
    const maxResults = Math.min(Math.max(Number(args.maxResults || 30), 1), 200);
    const { results, meta } = searchCodeSmart(index, query, {
      scope: args.scope ? String(args.scope) : undefined,
      maxResults,
    });
    const suggestions = results.length === 0 ? symbolSuggestions(index, query, 10) : [];
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      count: results.length,
      search_meta: meta,
      suggestions,
      results,
    });
  }

  if (name === 'read_function') {
    const rawName = argString(args, ['name', 'routine', 'function', 'symbol']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['routine', 'function', 'symbol']);
    const parsed = parseSymbolName(rawName);
    const routineName = parsed.name;
    if (!routineName) return invalidMissingArgWithAliases('name', ['routine', 'function', 'symbol']);
    if (isVB6ComponentFile(routineName)) {
      return toolError(
        `"${routineName}" looks like a filename, not a routine. Pass it as 'file' plus a routine 'name', or use module_info/list_symbols to enumerate its routines.`,
        'invalid_args',
        { name: routineName },
      );
    }
    const fileArg = argString(args, ['file', 'path', 'module', 'filename']) || parsed.moduleHint || null;
    const maxBodyLines = Math.min(Math.max(Number(args.maxBodyLines || 240), 1), 400);

    let index = ensureIndex().index;
    let fileMatch: { filePath: string; symbols: any[] } | null = null;
    let resolutionNote: string | undefined;
    let alternates: string[] = [];

    if (fileArg) {
      const smart = resolveFileSmart(fileArg, routineName);
      index = smart.index;
      fileMatch = smart.resolution.match;
      if (fileMatch && smart.resolution.resolution) {
        resolutionNote = `File '${fileArg}' resolved to ${fileMatch.filePath} (${smart.resolution.resolution}).`;
        alternates = smart.resolution.candidates;
      }
      if (!fileMatch) {
        // The file could not be pinned down. If the routine itself is unique
        // across the workspace, serve it anyway — that is what the caller wants.
        const globalMatches = routineSymbols(index, routineName);
        if (globalMatches.length === 1) {
          const only = globalMatches[0];
          return toolResult({
            workspaceRoot: workspaceConfig.rootDir,
            indexedAt,
            file: only.file,
            resolution_note: `File '${fileArg}' not resolved; routine '${routineName}' is unique in the workspace (${only.file}).`,
            symbol: { ...only, parsedSignature: formatSignature(only) },
            body: readSymbolBody(index, only, maxBodyLines),
          });
        }
        return smart.resolution.candidates.length > 0
          ? fileResolutionError(fileArg, smart.resolution.candidates)
          : toolError(`File not found: ${fileArg}`, 'not_found', {
            file: fileArg,
            routineCandidates: globalMatches.map((symbol) => ({
              file: symbol.file,
              name: symbol.name,
              kind: symbol.kind,
              line: symbol.line,
              signature: formatSignature(symbol),
            })),
          });
      }
    }

    if (!fileMatch) {
      // No usable file context: only serve the routine when it is unique,
      // otherwise force the caller to pick — never silently return one of many.
      const globalMatches = routineSymbols(index, routineName);
      if (globalMatches.length > 1) {
        return toolError(
          `Routine "${routineName}" has ${globalMatches.length} definitions; pass a file to choose one.`,
          'ambiguous_file',
          {
            name: routineName,
            routineCandidates: globalMatches.map((entry) => ({
              file: entry.file,
              name: entry.name,
              kind: entry.kind,
              line: entry.line,
              signature: formatSignature(entry),
            })),
          },
        );
      }
    }

    const candidates = fileMatch ? fileMatch.symbols : routineSymbols(index, routineName);
    const symbol = candidates.find((entry) =>
      entry.name.toLowerCase() === routineName.toLowerCase() &&
      isRoutineSymbol(entry),
    );
    if (!symbol) {
      if (fileMatch) {
        // Routine missing from the requested file — check the rest of the workspace.
        const globalMatches = routineSymbols(index, routineName);
        if (globalMatches.length === 1) {
          const only = globalMatches[0];
          return toolResult({
            workspaceRoot: workspaceConfig.rootDir,
            indexedAt,
            file: only.file,
            resolution_note: `Routine '${routineName}' is not in ${fileMatch.filePath}; serving its unique definition from ${only.file}.`,
            symbol: { ...only, parsedSignature: formatSignature(only) },
            body: readSymbolBody(index, only, maxBodyLines),
          });
        }
        if (globalMatches.length > 1) {
          return toolError(
            `Routine "${routineName}" not found in ${fileMatch.filePath}, but it exists in ${globalMatches.length} other file(s).`,
            'not_found',
            {
              file: fileMatch.filePath,
              name: routineName,
              routineCandidates: globalMatches.map((entry) => ({
                file: entry.file,
                name: entry.name,
                kind: entry.kind,
                line: entry.line,
                signature: formatSignature(entry),
              })),
            },
          );
        }
      }
      const suggestions = routineOnlySuggestions(index, routineName, 10);
      return toolError(
        fileMatch
          ? `Routine "${routineName}" not found in ${fileMatch.filePath}`
          : `Routine "${routineName}" not found`,
        'not_found',
        {
          file: fileMatch?.filePath,
          name: routineName,
          routineCandidates: suggestions,
        },
      );
    }

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      file: symbol.file,
      ...(resolutionNote ? { resolution_note: resolutionNote, alternates } : {}),
      symbol: {
        ...symbol,
        parsedSignature: formatSignature(symbol),
      },
      body: readSymbolBody(index, symbol, maxBodyLines),
    });
  }

  if (name === 'signature') {
    const rawName = argString(args, ['name', 'symbol', 'routine', 'function']);
    if (!rawName) return invalidMissingArgWithAliases('name', ['symbol', 'routine', 'function']);
    const signatureName = parseSymbolName(rawName).name;
    const { index } = ensureIndex();
    const matches = (index.byName.get(signatureName.toLowerCase()) || [])
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
      ...(matches.length === 0 ? { suggestions: symbolSuggestions(index, signatureName, 8) } : {}),
      matches,
    });
  }

  if (name === 'module_info') {
    const fileArg = argString(args, ['file', 'path', 'module', 'filename']);
    if (!fileArg) return invalidMissingArgWithAliases('file', ['path', 'module', 'filename']);
    const { index, resolution } = resolveFileSmart(fileArg);
    if (!resolution.match) {
      return fileResolutionError(fileArg, resolution.candidates);
    }

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      ...(resolution.resolution ? { resolution_note: `'${fileArg}' resolved to ${resolution.match.filePath} (${resolution.resolution})`, alternates: resolution.candidates } : {}),
      ...summarizeModule(index, resolution.match.filePath, resolution.match.symbols),
    });
  }

  if (name === 'type_members') {
    const rawTypeName = argString(args, ['typeName', 'name', 'type', 'class']);
    if (!rawTypeName) return invalidMissingArgWithAliases('typeName', ['name', 'type', 'class']);
    const { index } = ensureIndex();
    const typeName = rawTypeName.toLowerCase();
    const matches = index.symbols.filter((symbol) =>
      (symbol.scope === 'member' && symbol.containerName?.toLowerCase() === typeName) ||
      (symbol.scope === 'module' && symbol.moduleName.toLowerCase() === typeName && symbol.kind !== 'Type' && symbol.kind !== 'Enum' && symbol.kind !== 'Implements'),
    );

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      typeName: rawTypeName,
      count: matches.length,
      ...(matches.length === 0 ? { suggestions: symbolSuggestions(index, rawTypeName, 8) } : {}),
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
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      projectFiles: workspaceConfig.projectFiles,
      sourceDirs: workspaceConfig.sourceDirs,
      projects: workspaceConfig.projects.map((project) => ({
        file: project.file,
        name: project.name,
        type: project.type,
        componentCount: project.components.length,
        referenceCount: project.references.length,
        objectCount: project.objects.length,
      })),
      externalReferenceCount: workspaceConfig.externalReferences.length,
      externalReferences: workspaceConfig.externalReferences.map((ref) => ref.description || ref.libraryName || ref.guid || ref.raw).filter(Boolean),
      objectReferenceCount: workspaceConfig.objectReferences.length,
      objectReferences: workspaceConfig.objectReferences.map((ref) => ref.description || ref.libraryName || ref.raw).filter(Boolean),
      indexedAt,
      indexed: Boolean(cachedIndex),
    });
  }

  if (name === 'index_stats') {
    if (cachedIndex) {
      return toolResult({
        workspaceRoot: workspaceConfig.rootDir,
        projectFiles: workspaceConfig.projectFiles,
        sourceDirs: workspaceConfig.sourceDirs,
        projectCount: workspaceConfig.projects.length,
        externalReferenceCount: workspaceConfig.externalReferences.length,
        indexedAt,
        files: cachedIndex.files.length,
        symbols: cachedIndex.symbols.length,
        indexed: true,
      });
    }
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      projectFiles: workspaceConfig.projectFiles,
      sourceDirs: workspaceConfig.sourceDirs,
      projectCount: workspaceConfig.projects.length,
      externalReferenceCount: workspaceConfig.externalReferences.length,
      indexedAt: null,
      files: 0,
      symbols: 0,
      indexed: false,
      hint: 'Index not built yet. Call any tool or reindex_vb6 to trigger indexing.',
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

  if (name === 'batch_search_code') {
    const { index } = ensureIndex();
    const queries = Array.isArray(args.queries) ? args.queries as Array<Record<string, unknown>> : [];
    // All queries in the batch share one fallback budget so ten zero-hit scoped
    // queries cannot stack ten full-workspace rescue sweeps.
    const sharedFallbackDeadline = Date.now() + 1200;
    const results = queries.slice(0, 10).map((q) => {
      const query = String(q.query || '');
      const maxResults = Math.min(Math.max(Number(q.maxResults || 15), 1), 100);
      const { results: hits, meta } = searchCodeSmart(index, query, {
        scope: q.scope ? String(q.scope) : undefined,
        maxResults,
        fallbackDeadline: sharedFallbackDeadline,
      });
      return {
        query,
        count: hits.length,
        search_meta: meta,
        suggestions: hits.length === 0 ? symbolSuggestions(index, query, 5) : [],
        results: hits,
      };
    });
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      queryCount: results.length,
      results,
    });
  }

  if (name === 'batch_read_function') {
    const functions = Array.isArray(args.functions) ? args.functions as Array<Record<string, unknown>> : [];
    const results = functions.slice(0, 10).map((fn) => {
      const maxBodyLines = Math.min(Math.max(Number(fn.maxBodyLines || 240), 1), 400);
      const parsed = parseSymbolName(String(fn.name || ''));
      const routineName = parsed.name;
      const fileArg = String(fn.file || '') || parsed.moduleHint || '';
      const { index, resolution } = resolveFileSmart(fileArg, routineName);
      const fileMatch = resolution.match;
      if (!fileMatch) {
        // Same rescue as read_function: unique routine wins over a bad file hint.
        const globalMatches = routineSymbols(index, routineName);
        if (globalMatches.length === 1) {
          const only = globalMatches[0];
          return {
            file: only.file,
            name: only.name,
            kind: only.kind,
            line: only.line,
            signature: formatSignature(only),
            resolution_note: `File '${fileArg}' not resolved; routine '${routineName}' is unique in the workspace.`,
            body: readSymbolBody(index, only, maxBodyLines),
            error: null,
          };
        }
        return {
          file: fileArg,
          name: routineName,
          error: 'File not found',
          error_kind: resolution.candidates.length > 0 ? 'ambiguous_file' : 'not_found',
          candidates: formatFileCandidates(resolution.candidates),
          routineCandidates: globalMatches.slice(0, 5).map((entry) => ({
            file: entry.file,
            name: entry.name,
            kind: entry.kind,
            line: entry.line,
          })),
          body: null,
        };
      }
      const symbol = fileMatch.symbols.find((entry) =>
        entry.name.toLowerCase() === routineName.toLowerCase() &&
        (entry.kind === 'Sub' || entry.kind === 'Function' || entry.kind === 'Property' || entry.kind === 'Declare'),
      );
      if (!symbol) {
        const globalMatches = routineSymbols(index, routineName);
        if (globalMatches.length === 1) {
          const only = globalMatches[0];
          return {
            file: only.file,
            name: only.name,
            kind: only.kind,
            line: only.line,
            signature: formatSignature(only),
            resolution_note: `Routine '${routineName}' is not in ${fileMatch.filePath}; serving its unique definition from ${only.file}.`,
            body: readSymbolBody(index, only, maxBodyLines),
            error: null,
          };
        }
        return {
          file: fileMatch.filePath,
          name: routineName,
          error: 'Routine not found',
          error_kind: 'not_found',
          routineCandidates: routineOnlySuggestions(index, routineName, 5),
          body: null,
        };
      }
      return {
        file: fileMatch.filePath,
        name: symbol.name,
        kind: symbol.kind,
        line: symbol.line,
        signature: formatSignature(symbol),
        ...(resolution.resolution ? { resolution_note: `File '${fileArg}' resolved to ${fileMatch.filePath} (${resolution.resolution}).` } : {}),
        body: readSymbolBody(index, symbol, maxBodyLines),
        error: null,
      };
    });
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      functionCount: results.length,
      results,
    });
  }

  if (name === 'inspect_frx') {
    const fileArg = argString(args, ['file', 'form', 'source']);
    if (!fileArg) return invalidMissingArgWithAliases('file', ['form', 'source']);
    const value = argString(args, ['value', 'reference', 'ref']);
    if (!value) return invalidMissingArgWithAliases('value', ['reference', 'ref']);
    const { resolution } = resolveFileSmart(fileArg);
    if (!resolution.match) return fileResolutionError(fileArg, resolution.candidates);

    const sourceFile = path.isAbsolute(resolution.match.filePath)
      ? resolution.match.filePath
      : path.resolve(workspaceConfig.rootDir, resolution.match.filePath);
    const inspection = inspectFrxReference(
      workspaceConfig.rootDir,
      sourceFile,
      value,
      {
        property: argString(args, ['property', 'prop']) || undefined,
        kind: typeof args.kind === 'string' ? args.kind : undefined,
        previewBytes: typeof args.previewBytes === 'number' ? args.previewBytes : undefined,
      },
    );
    if (!inspection.ok) return toolError(inspection.message, inspection.errorKind, inspection.details);
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      ...(resolution.resolution ? { resolution_note: `File '${fileArg}' resolved to ${resolution.match.filePath} (${resolution.resolution}).` } : {}),
      inspection,
    });
  }

  if (name === 'inspect_res') {
    const fileArg = argString(args, ['file', 'path', 'resource', 'filename']);
    if (!fileArg) return invalidMissingArgWithAliases('file', ['path', 'resource', 'filename']);
    const inspection = inspectResFile(workspaceConfig.rootDir, fileArg, {
      previewBytes: typeof args.previewBytes === 'number' ? args.previewBytes : undefined,
    });
    if (!inspection.ok) return toolError(inspection.message, inspection.errorKind, inspection.details);
    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      inspection,
    });
  }

  return toolError(`Unknown tool: ${name}`, 'unknown_tool');
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
            version: SERVER_VERSION,
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
      const toolArgs = (message.params?.arguments || {}) as Record<string, unknown>;
      const started = Date.now();
      const hadIndex = Boolean(cachedIndex);
      const hadDerived = Boolean(derivedCache);
      const result = await callTool(toolName, toolArgs);
      const telemetrySummary = summarizeToolResult(result);
      const rawInputs = (telemetrySummary.error || telemetrySummary.resultCount === 0)
        ? captureRawInputs(toolArgs)
        : undefined;
      recordTelemetry(telemetry, createTelemetryEvent(telemetry, {
        ts: new Date().toISOString(),
        request_id: typeof message.id !== 'undefined' ? String(message.id) : null,
        tool_name: toolName,
        duration_ms: Date.now() - started,
        result_count: telemetrySummary.resultCount,
        result_count_state: telemetrySummary.resultCountState,
        output_chars: telemetrySummary.outputChars,
        index_cache: cacheStateForTool(toolName, hadIndex, INDEX_CACHE_TOOLS),
        derived_cache: cacheStateForTool(toolName, hadDerived, DERIVED_CACHE_TOOLS),
        error: telemetrySummary.error,
        error_kind: telemetrySummary.errorKind,
        input_summary: summarizeToolArguments(toolArgs),
        ...(rawInputs ? { input_raw: rawInputs } : {}),
      }));
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
      const toolName = String(message.params?.name || '');
      const toolArgs = (message.params?.arguments || {}) as Record<string, unknown>;
      recordTelemetry(telemetry, createTelemetryEvent(telemetry, {
        ts: new Date().toISOString(),
        request_id: typeof message.id !== 'undefined' ? String(message.id) : null,
        tool_name: toolName,
        duration_ms: 0,
        result_count: null,
        result_count_state: 'unknown',
        output_chars: 0,
        index_cache: cacheStateForTool(toolName, Boolean(cachedIndex), INDEX_CACHE_TOOLS),
        derived_cache: cacheStateForTool(toolName, Boolean(derivedCache), DERIVED_CACHE_TOOLS),
        error: error instanceof Error ? error.message : String(error),
        error_kind: 'internal_error',
        input_summary: summarizeToolArguments(toolArgs),
        ...(((raw) => raw ? { input_raw: raw } : {})(captureRawInputs(toolArgs))),
      }));
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
