import { MCPSymbol, MCPIndex } from '../server/indexer/mcp-bridge';

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
  const fileLower = file.toLowerCase();
  for (const [filePath, symbols] of index.byFile) {
    if (filePath.toLowerCase().endsWith(fileLower)) {
      return { filePath, symbols };
    }
  }
  return null;
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
