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
import { resolveSymbolSet } from '../resolution';
import { getSymbolsForType } from '../memberAccess';
import { getDeclaredType, inferResolvedSymbolType } from '../typeInference';

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
  const lines = readLines(absolutePath);
  const builder = new SemanticTokensBuilder();
  const pushed = new Set<string>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const occurrences = findIdentifierOccurrences(lines[lineIndex]);
    for (const occurrence of occurrences) {
      const symbol = resolveSemanticSymbol(index, absolutePath, filePath, lines[lineIndex], occurrence.name, occurrence.start, lineIndex + 1);
      if (!symbol) continue;

      const tokenType = mapTokenType(symbol);
      if (tokenType < 0) continue;

      const key = `${lineIndex}:${occurrence.start}:${occurrence.end}:${tokenType}`;
      if (pushed.has(key)) continue;
      pushed.add(key);

      builder.push(lineIndex, occurrence.start, occurrence.end - occurrence.start, tokenType, 0);
    }
  }

  return builder.build();
}

function resolveSemanticSymbol(
  index: VB6Index,
  absoluteFile: string,
  currentFile: string,
  lineText: string,
  name: string,
  start: number,
  line: number,
): VB6Symbol | null {
  const member = resolveMemberSemanticSymbol(index, absoluteFile, lineText, name, start, line);
  if (member) return member;

  const matches = index.byName.get(name.toLowerCase()) || [];
  if (matches.length === 0) return null;

  const local = matches.find((symbol) =>
    normalizePath(symbol.file) === currentFile &&
    (symbol.scope === 'local' || symbol.scope === 'parameter') &&
    symbol.containerLine !== undefined &&
    symbol.containerLine <= line,
  );
  if (local) return local;

  const sameFile = matches.find((symbol) => normalizePath(symbol.file) === currentFile);
  if (sameFile) return sameFile;

  return matches[0] || null;
}

function resolveMemberSemanticSymbol(
  index: VB6Index,
  absoluteFile: string,
  lineText: string,
  name: string,
  start: number,
  line: number,
): VB6Symbol | null {
  let cursor = start;
  while (cursor > 0 && /\s/.test(lineText[cursor - 1])) cursor--;
  if (cursor <= 0 || lineText[cursor - 1] !== '.') return null;

  let receiverEnd = cursor - 1;
  while (receiverEnd > 0 && /\s/.test(lineText[receiverEnd - 1])) receiverEnd--;
  let receiverStart = receiverEnd;
  while (receiverStart > 0 && /[A-Za-z0-9_]/.test(lineText[receiverStart - 1])) receiverStart--;
  const receiver = lineText.substring(receiverStart, receiverEnd);
  if (!receiver) return null;

  const resolved = resolveSymbolSet(index, receiver, absoluteFile, line);
  const primary = resolved.definitions[0];
  if (!primary) return null;
  const typeName = getDeclaredType(primary) || inferResolvedSymbolType(index, resolved, absoluteFile, line);
  if (!typeName) return null;

  return getSymbolsForType(index, typeName, name)[0] || null;
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
