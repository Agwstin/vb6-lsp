import {
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensParams,
  SemanticTokensLegend,
} from 'vscode-languageserver';
import * as fs from 'fs';
import { VB6Index, VB6Symbol } from '../indexer/types';
import { uriToPath, normalizePath } from '../utils';
import { findIdentifierOccurrences } from '../indexer/parser';

export const VB6_SEMANTIC_TOKEN_TYPES = [
  'class',
  'function',
  'method',
  'property',
  'variable',
  'parameter',
  'enum',
  'struct',
  'event',
  'interface',
  'namespace',
] as const;

export const VB6_SEMANTIC_TOKEN_LEGEND: SemanticTokensLegend = {
  tokenTypes: [...VB6_SEMANTIC_TOKEN_TYPES],
  tokenModifiers: [],
};

export function handleSemanticTokens(
  params: SemanticTokensParams,
  index: VB6Index,
): SemanticTokens {
  const absolutePath = uriToPath(params.textDocument.uri);
  const filePath = normalizePath(absolutePath);
  const symbols = index.byFile.get(filePath) || [];
  const builder = new SemanticTokensBuilder();
  const lines = readLines(absolutePath);

  for (const symbol of symbols) {
    const tokenType = mapTokenType(symbol);
    if (tokenType < 0) continue;

    const lineText = lines[symbol.line - 1];
    if (!lineText) continue;

    const occurrence = findIdentifierOccurrences(lineText, symbol.name)[0];
    if (!occurrence) continue;

    builder.push(symbol.line - 1, occurrence.start, occurrence.end - occurrence.start, tokenType, 0);
  }

  return builder.build();
}

function readLines(filePath: string): string[] {
  try {
    return fs.readFileSync(filePath, 'latin1').split(/\r?\n/);
  } catch {
    return [];
  }
}

function mapTokenType(symbol: VB6Symbol): number {
  switch (symbol.kind) {
    case 'Type': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('struct');
    case 'Enum': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('enum');
    case 'Implements': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('interface');
    case 'Sub': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('method');
    case 'Function': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('function');
    case 'Property': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('property');
    case 'Variable': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('variable');
    case 'Parameter': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('parameter');
    case 'Field': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('property');
    case 'Event': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('event');
    case 'Declare': return VB6_SEMANTIC_TOKEN_TYPES.indexOf('function');
    default: return -1;
  }
}
