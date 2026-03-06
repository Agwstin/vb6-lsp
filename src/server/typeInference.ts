import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index, VB6Symbol } from './indexer/types';
import { ResolvedSymbolSet } from './resolution';
import { findEnclosingRoutine, resolveSymbolSet } from './resolution';
import { getSymbolsForType } from './memberAccess';
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

  return inferTypeFromAssignments(index, filePath, lines.slice(lineStart, lineEnd + 1), definition.name, lineStart + 1);
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

function inferTypeFromAssignments(index: VB6Index, currentFile: string, lines: string[], name: string, firstLineNumber: number): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const newPattern = new RegExp(`^(?:\\s*Set\\s+)?${escapedName}\\s*=\\s*New\\s+([\\w.]+)`, 'i');
  const callPattern = new RegExp(`^(?:\\s*Set\\s+)?${escapedName}\\s*=\\s*([\\w.]+)\\s*\\(`, 'i');
  const memberCallPattern = new RegExp(`^(?:\\s*Set\\s+)?${escapedName}\\s*=\\s*(\\w+)\\.(\\w+)\\s*\\(`, 'i');
  const assignmentPattern = new RegExp(`^(?:\\s*Set\\s+)?${escapedName}\\s*=\\s*(\\w+)$`, 'i');
  const memberAccessPattern = new RegExp(`^(?:\\s*Set\\s+)?${escapedName}\\s*=\\s*(\\w+)\\.(\\w+)$`, 'i');
  const literalStringPattern = new RegExp(`^${escapedName}\\s*=\\s*"`, 'i');
  const literalBooleanPattern = new RegExp(`^${escapedName}\\s*=\\s*(True|False)\\b`, 'i');
  const literalNumberPattern = new RegExp(`^${escapedName}\\s*=\\s*-?\\d+(?:\\.\\d+)?\\b`, 'i');

  for (let cursor = lines.length - 1; cursor >= 0; cursor--) {
    const line = lines[cursor].trim();
    const absoluteLine = firstLineNumber + cursor;

    const newMatch = line.match(newPattern);
    if (newMatch) return newMatch[1];

    const memberCallMatch = line.match(memberCallPattern);
    if (memberCallMatch) {
      const type = inferMemberResultType(index, currentFile, memberCallMatch[1], memberCallMatch[2]);
      if (type) return type;
    }

    const callMatch = line.match(callPattern);
    if (callMatch) {
      const type = inferCallableType(index, callMatch[1]);
      if (type) return type;
    }

    const memberAccessMatch = line.match(memberAccessPattern);
    if (memberAccessMatch) {
      const type = inferMemberResultType(index, currentFile, memberAccessMatch[1], memberAccessMatch[2]);
      if (type) return type;
    }

    const assignmentMatch = line.match(assignmentPattern);
    if (assignmentMatch) {
      const type = inferVariableType(index, currentFile, assignmentMatch[1], absoluteLine);
      if (type) return type;
    }

    if (literalStringPattern.test(line)) return 'String';
    if (literalBooleanPattern.test(line)) return 'Boolean';
    if (literalNumberPattern.test(line)) return 'Long';
  }

  return null;
}

function inferCallableType(index: VB6Index, callableName: string): string | null {
  const symbols = index.byName.get(callableName.toLowerCase()) || [];
  const typedMatch = symbols.find((symbol) => symbol.returnType);
  return typedMatch?.returnType || null;
}

function inferVariableType(index: VB6Index, currentFile: string, variableName: string, line: number): string | null {
  const resolved = resolveSymbolSet(index, variableName, currentFile, line);
  const definition = resolved.definitions[0];
  if (!definition) return null;
  return getDeclaredType(definition);
}

function inferMemberResultType(index: VB6Index, currentFile: string, receiverName: string, memberName: string): string | null {
  const receiverResolved = resolveSymbolSet(index, receiverName, currentFile, Number.MAX_SAFE_INTEGER);
  const receiverType = getDeclaredType(receiverResolved.definitions[0]) || inferResolvedSymbolType(
    index,
    receiverResolved,
    currentFile,
    Number.MAX_SAFE_INTEGER,
  );
  if (!receiverType) return null;

  const members = getSymbolsForType(index, receiverType, memberName);
  const typedMember = members.find((member) => member.returnType);
  return typedMember?.returnType || null;
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
