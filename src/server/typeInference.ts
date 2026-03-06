import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index, VB6Symbol } from './indexer/types';
import { ResolvedSymbolSet } from './resolution';
import { findEnclosingRoutine } from './resolution';
import { normalizePath } from './utils';

export function inferResolvedSymbolType(
  index: VB6Index,
  resolved: ResolvedSymbolSet,
  currentFile: string,
  line: number,
  document?: TextDocument,
): string | null {
  const definition = resolved.definitions[0];
  if (!definition) return null;

  const declared = getDeclaredType(definition);
  if (declared) return declared;

  if (definition.scope !== 'local' && definition.scope !== 'parameter') {
    return null;
  }

  const filePath = resolved.definitions[0].file;
  const lines = readLines(filePath, document);
  if (!lines) return null;

  const routine = findEnclosingRoutine(index, normalizePath(filePath), line);
  const lineStart = routine ? routine.line - 1 : 0;
  const lineEnd = Math.max(lineStart, line - 1);

  return inferTypeFromAssignments(index, lines.slice(lineStart, lineEnd + 1), definition.name);
}

export function getDeclaredType(symbol: VB6Symbol): string | null {
  if ((symbol.kind === 'Function' || symbol.kind === 'Property' || symbol.kind === 'Declare') && symbol.returnType) {
    return symbol.returnType;
  }

  if ((symbol.kind === 'Variable' || symbol.kind === 'Parameter' || symbol.kind === 'Field') && symbol.returnType && symbol.returnType !== 'Variant') {
    return symbol.returnType;
  }

  return null;
}

function inferTypeFromAssignments(index: VB6Index, lines: string[], name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const newPattern = new RegExp(`^(?:\\s*Set\\s+)?${escapedName}\\s*=\\s*New\\s+([\\w.]+)`, 'i');
  const callPattern = new RegExp(`^(?:\\s*Set\\s+)?${escapedName}\\s*=\\s*([\\w.]+)\\s*\\(`, 'i');

  for (let cursor = lines.length - 1; cursor >= 0; cursor--) {
    const line = lines[cursor].trim();

    const newMatch = line.match(newPattern);
    if (newMatch) return newMatch[1];

    const callMatch = line.match(callPattern);
    if (callMatch) {
      const functionName = callMatch[1];
      const symbols = index.byName.get(functionName.toLowerCase()) || [];
      const typedMatch = symbols.find((symbol) => symbol.returnType);
      if (typedMatch?.returnType) {
        return typedMatch.returnType;
      }
    }
  }

  return null;
}

function readLines(filePath: string, document?: TextDocument): string[] | null {
  if (document) {
    return document.getText().split(/\r?\n/);
  }

  try {
    return fs.readFileSync(filePath, 'latin1').split(/\r?\n/);
  } catch {
    return null;
  }
}
