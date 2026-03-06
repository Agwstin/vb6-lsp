import {
  DocumentSymbolParams,
  DocumentSymbol,
  SymbolKind,
  Range,
} from 'vscode-languageserver';
import { VB6Index, VB6Symbol, VB6SymbolKind } from '../indexer/types';
import { uriToPath, normalizePath } from '../utils';

export function handleDocumentSymbol(
  params: DocumentSymbolParams,
  index: VB6Index,
): DocumentSymbol[] {
  const filePath = uriToPath(params.textDocument.uri);
  const normPath = normalizePath(filePath);
  const symbols = index.byFile.get(normPath);
  if (!symbols) return [];

  const routineChildren = new Map<number, DocumentSymbol[]>();
  const topLevel: DocumentSymbol[] = [];

  for (const symbol of symbols) {
    if (symbol.scope === 'parameter' || symbol.scope === 'local') {
      if (!symbol.containerLine) continue;

      const children = routineChildren.get(symbol.containerLine) || [];
      children.push(buildSymbol(symbol));
      routineChildren.set(symbol.containerLine, children);
      continue;
    }

    topLevel.push(buildSymbol(symbol));
  }

  for (const symbol of topLevel) {
    const key = symbol.range.start.line + 1;
    const children = routineChildren.get(key);
    if (children && children.length > 0) {
      symbol.children = children.sort(compareDocumentSymbols);
    }
  }

  return topLevel.sort(compareDocumentSymbols);
}

function buildSymbol(symbol: VB6Symbol): DocumentSymbol {
  const endLine = symbol.endLine > symbol.line ? symbol.endLine - 1 : symbol.line - 1;
  const endCol = symbol.endLine > symbol.line ? 0 : Math.max(symbol.signature.length, symbol.name.length);
  const range = Range.create(symbol.line - 1, 0, endLine, endCol);
  const selectionRange = Range.create(symbol.line - 1, 0, symbol.line - 1, symbol.name.length);
  const detail = symbol.scope === 'module'
    ? symbol.signature
    : `${symbol.kind} in ${symbol.containerName ?? symbol.moduleName}`;

  return DocumentSymbol.create(
    symbol.accessor ? `${symbol.name} (${symbol.accessor})` : symbol.name,
    detail,
    mapSymbolKind(symbol.kind),
    range,
    selectionRange,
  );
}

function compareDocumentSymbols(left: DocumentSymbol, right: DocumentSymbol): number {
  return left.range.start.line - right.range.start.line;
}

function mapSymbolKind(kind: VB6SymbolKind): SymbolKind {
  switch (kind) {
    case 'Sub': return SymbolKind.Method;
    case 'Function': return SymbolKind.Function;
    case 'Property': return SymbolKind.Property;
    case 'Type': return SymbolKind.Struct;
    case 'Enum': return SymbolKind.Enum;
    case 'Const': return SymbolKind.Constant;
    case 'Declare': return SymbolKind.Function;
    case 'Variable': return SymbolKind.Variable;
    case 'Event': return SymbolKind.Event;
    case 'Parameter': return SymbolKind.Variable;
    default: return SymbolKind.Variable;
  }
}
