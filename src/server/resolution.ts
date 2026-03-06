import { VB6Index, VB6Symbol } from './indexer/types';
import { normalizePath } from './utils';

export interface ResolvedSymbolSet {
  word: string;
  currentFile: string;
  line: number;
  routine?: VB6Symbol;
  definitions: VB6Symbol[];
}

export function resolveSymbolSet(
  index: VB6Index,
  word: string,
  currentFile: string,
  line: number,
): ResolvedSymbolSet {
  const normalizedFile = normalizePath(currentFile);
  const allMatches = index.byName.get(word.toLowerCase()) || [];
  const routine = findEnclosingRoutine(index, normalizedFile, line);

  const localMatches = routine
    ? allMatches.filter((symbol) =>
        normalizePath(symbol.file) === normalizedFile &&
        symbol.containerLine === routine.line &&
        (symbol.scope === 'local' || symbol.scope === 'parameter'),
      )
    : [];

  if (localMatches.length > 0) {
    return { word, currentFile: normalizedFile, line, routine, definitions: localMatches };
  }

  const sameFileModuleMatches = allMatches.filter((symbol) =>
    normalizePath(symbol.file) === normalizedFile && symbol.scope === 'module',
  );

  const sameFilePrivate = sameFileModuleMatches.filter((symbol) => symbol.visibility !== 'Public');
  if (sameFilePrivate.length > 0) {
    return { word, currentFile: normalizedFile, line, routine, definitions: sameFilePrivate };
  }

  if (sameFileModuleMatches.length > 0) {
    return { word, currentFile: normalizedFile, line, routine, definitions: sameFileModuleMatches };
  }

  const publicMatches = allMatches.filter((symbol) => symbol.scope === 'module');
  return { word, currentFile: normalizedFile, line, routine, definitions: publicMatches };
}

export function findEnclosingRoutine(
  index: VB6Index,
  currentFile: string,
  line: number,
): VB6Symbol | undefined {
  const fileSymbols = index.byFile.get(currentFile);
  if (!fileSymbols) return undefined;

  return fileSymbols.find((symbol) =>
    symbol.scope === 'module' &&
    (symbol.kind === 'Sub' || symbol.kind === 'Function' || symbol.kind === 'Property') &&
    symbol.line <= line &&
    symbol.endLine >= line,
  );
}

export function isAmbiguousPublicDefinition(definitions: VB6Symbol[]): boolean {
  const publicModuleDefinitions = definitions.filter(
    (symbol) => symbol.scope === 'module' && symbol.visibility === 'Public',
  );
  const keys = new Set(publicModuleDefinitions.map((symbol) => `${normalizePath(symbol.file)}:${symbol.line}`));
  return keys.size > 1;
}

export function getSearchTargets(index: VB6Index, resolved: ResolvedSymbolSet): Array<{
  filePath: string;
  lineStart: number;
  lineEnd: number;
}> {
  const definition = resolved.definitions[0];
  if (!definition) return [];

  if (definition.scope === 'local' || definition.scope === 'parameter') {
    const routine = resolved.routine;
    if (!routine) return [];
    return [{
      filePath: definition.file,
      lineStart: routine.line,
      lineEnd: routine.endLine,
    }];
  }

  if (definition.visibility !== 'Public') {
    return [{
      filePath: definition.file,
      lineStart: 1,
      lineEnd: Number.MAX_SAFE_INTEGER,
    }];
  }

  const targets: Array<{ filePath: string; lineStart: number; lineEnd: number }> = [];
  for (const normalizedFile of index.files) {
    const fileSymbols = index.byFile.get(normalizedFile);
    const filePath = fileSymbols?.[0]?.file;
    if (!filePath) continue;
    targets.push({
      filePath,
      lineStart: 1,
      lineEnd: Number.MAX_SAFE_INTEGER,
    });
  }

  return targets;
}
