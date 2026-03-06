import { Buffer } from 'node:buffer';
import { buildVB6Index, findReferences, searchCode } from '../server/indexer/mcp-bridge';
import { resolveWorkspaceConfig, VB6ServerSettings } from '../server/config';
import { findFileSymbols, formatSignature, readSymbolBody, summarizeModule } from './utils';

const workspaceConfig = resolveWorkspaceConfig({
  rootUri: process.env.VB6_LSP_ROOT ? `file:///${process.env.VB6_LSP_ROOT.replace(/\\/g, '/')}` : undefined,
  settings: extractSettingsFromEnv(),
});

let cachedIndex: ReturnType<typeof buildVB6Index> | null = null;
let indexedAt: string | null = null;

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
  if (!cachedIndex || force) {
    cachedIndex = buildVB6Index(workspaceConfig.rootDir, workspaceConfig.sourceDirs);
    indexedAt = new Date().toISOString();
  }
  return cachedIndex;
}

function writeMessage(message: unknown) {
  const json = JSON.stringify(message);
  process.stdout.write(json + '\n');
}

function listTools() {
  return [
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
  if (name === 'find_symbol') {
    const index = ensureIndex();
    const limit = Math.min(Math.max(Number(args.limit || 20), 1), 100);
    const includeBody = args.includeBody !== false;
    const maxBodyLines = Math.min(Math.max(Number(args.maxBodyLines || 120), 1), 300);
    const matches = (index.byName.get(String(args.name).toLowerCase()) || [])
      .filter((symbol) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase())
      .slice(0, limit)
      .map((symbol) => ({
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
    const index = ensureIndex();
    const limit = Math.min(Math.max(Number(args.limit || 60), 1), 200);
    const kindFilter = args.kind ? String(args.kind).toLowerCase() : '';
    const nameFilter = args.filter ? String(args.filter).toLowerCase() : '';

    let symbols = index.symbols;
    let resolvedFile: string | undefined;
    if (args.file) {
      const fileMatch = findFileSymbols(index, String(args.file));
      if (!fileMatch) {
        return toolError(`File not found: ${String(args.file)}`);
      }
      resolvedFile = fileMatch.filePath;
      symbols = fileMatch.symbols;
    }

    const matches = symbols
      .filter((symbol) => !kindFilter || symbol.kind.toLowerCase() === kindFilter)
      .filter((symbol) => !nameFilter || symbol.name.toLowerCase().includes(nameFilter))
      .slice(0, limit)
      .map((symbol) => ({
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
    const index = ensureIndex();
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
    const index = ensureIndex();
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
    const index = ensureIndex();
    const maxBodyLines = Math.min(Math.max(Number(args.maxBodyLines || 240), 1), 400);
    const fileMatch = findFileSymbols(index, String(args.file));
    if (!fileMatch) {
      return toolError(`File not found: ${String(args.file)}`);
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
    const index = ensureIndex();
    const matches = (index.byName.get(String(args.name).toLowerCase()) || [])
      .filter((symbol) => !args.kind || symbol.kind.toLowerCase() === String(args.kind).toLowerCase())
      .map((symbol) => ({
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
    const index = ensureIndex();
    const fileMatch = findFileSymbols(index, String(args.file));
    if (!fileMatch) {
      return toolError(`File not found: ${String(args.file)}`);
    }

    return toolResult({
      workspaceRoot: workspaceConfig.rootDir,
      indexedAt,
      ...summarizeModule(index, fileMatch.filePath, fileMatch.symbols),
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
    const index = ensureIndex();
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
    const index = ensureIndex(true);
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
            version: '2.1.0',
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
      const result = await callTool(message.params?.name, message.params?.arguments || {});
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
