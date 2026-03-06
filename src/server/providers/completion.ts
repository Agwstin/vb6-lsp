import {
  CompletionParams,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index, VB6Symbol, VB6SymbolKind } from '../indexer/types';
import { getWordAtPosition, uriToPath, normalizePath } from '../utils';
import { findEnclosingRoutine } from '../resolution';
import { getMemberAccessContext, resolveMemberSymbols } from '../memberAccess';

const MAX_COMPLETIONS = 100;

export function handleCompletion(
  params: CompletionParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index,
): CompletionItem[] {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return [];

  const text = doc.getText();
  const offset = doc.offsetAt(params.position);
  const currentFilePath = uriToPath(params.textDocument.uri);
  const currentFile = normalizePath(currentFilePath);
  const routine = findEnclosingRoutine(index, currentFile, params.position.line + 1);

  const memberAccess = getMemberAccessContext(doc, params.position.line, params.position.character);
  if (memberAccess) {
    const resolvedMember = resolveMemberSymbols(
      index,
      doc,
      currentFilePath,
      params.position.line + 1,
      memberAccess.receiverName,
    );
    if (!resolvedMember) return [];

    return resolvedMember.symbols
      .filter((symbol) => !memberAccess.memberPrefix || symbol.name.toLowerCase().startsWith(memberAccess.memberPrefix.toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, MAX_COMPLETIONS)
      .map((symbol) => ({
        label: symbol.name,
        kind: mapCompletionKind(symbol.kind),
        detail: `${resolvedMember.typeName} member`,
        documentation: symbol.signature,
        insertTextFormat: InsertTextFormat.PlainText,
      }));
  }

  let prefixStart = offset;
  while (prefixStart > 0 && /[a-zA-Z0-9_]/.test(text[prefixStart - 1])) {
    prefixStart--;
  }

  const prefix = text.substring(prefixStart, offset).toLowerCase();
  if (prefix.length < 1) return [];

  const results: Array<{ symbol: VB6Symbol; score: number }> = [];
  const seen = new Set<string>();

  for (const [nameKey, symbols] of index.byName) {
    if (!nameKey.startsWith(prefix)) continue;

    for (const symbol of symbols) {
      if (!isAccessible(symbol, currentFile, routine?.line)) continue;

      const dedupeKey = `${nameKey}:${symbol.scope}:${symbol.moduleName}:${symbol.containerLine ?? 0}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      results.push({
        symbol,
        score: scoreSymbol(symbol, currentFile, routine?.line),
      });
    }
  }

  return results
    .sort((left, right) => right.score - left.score || left.symbol.name.localeCompare(right.symbol.name))
    .slice(0, MAX_COMPLETIONS)
    .map(({ symbol }) => ({
      label: symbol.name,
      kind: mapCompletionKind(symbol.kind),
      detail: buildDetail(symbol),
      documentation: symbol.signature,
      insertTextFormat: InsertTextFormat.PlainText,
    }));
}

function isAccessible(symbol: VB6Symbol, currentFile: string, routineLine?: number): boolean {
  const sameFile = normalizePath(symbol.file) === currentFile;

  if (symbol.scope === 'parameter' || symbol.scope === 'local') {
    return sameFile && symbol.containerLine === routineLine;
  }
  if (symbol.scope === 'member') {
    return false;
  }

  if (symbol.visibility === 'Public') return true;
  return sameFile;
}

function scoreSymbol(symbol: VB6Symbol, currentFile: string, routineLine?: number): number {
  const sameFile = normalizePath(symbol.file) === currentFile;

  if ((symbol.scope === 'parameter' || symbol.scope === 'local') && symbol.containerLine === routineLine) {
    return 300;
  }
  if (sameFile && symbol.scope === 'module') {
    return symbol.visibility === 'Public' ? 220 : 240;
  }
  if (symbol.visibility === 'Public') {
    return 150;
  }
  return 100;
}

function buildDetail(symbol: VB6Symbol): string {
  const scopeLabel = symbol.scope === 'module' ? symbol.kind : `${symbol.kind} (${symbol.scope})`;
  if (symbol.containerName) {
    return `${symbol.moduleName}.${symbol.containerName} [${scopeLabel}]`;
  }
  return `${symbol.moduleName} [${scopeLabel}]`;
}

function mapCompletionKind(kind: VB6SymbolKind): CompletionItemKind {
  switch (kind) {
    case 'Sub': return CompletionItemKind.Method;
    case 'Function': return CompletionItemKind.Function;
    case 'Property': return CompletionItemKind.Property;
    case 'Type': return CompletionItemKind.Struct;
    case 'Enum': return CompletionItemKind.Enum;
    case 'Const': return CompletionItemKind.Constant;
    case 'Declare': return CompletionItemKind.Function;
    case 'Variable': return CompletionItemKind.Variable;
    case 'Event': return CompletionItemKind.Event;
    case 'Parameter': return CompletionItemKind.Variable;
    case 'Field': return CompletionItemKind.Field;
    case 'Implements': return CompletionItemKind.Interface;
    default: return CompletionItemKind.Text;
  }
}
