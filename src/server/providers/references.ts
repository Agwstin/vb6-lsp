import {
  ReferenceParams,
  Location,
  Range,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import { VB6Index } from '../indexer/types';
import { getWordAtPosition, pathToUri, uriToPath, normalizePath } from '../utils';
import { findIdentifierOccurrences } from '../indexer/parser';
import { getSearchTargets, resolveSymbolSet } from '../resolution';

export function handleReferences(
  params: ReferenceParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index,
): Location[] | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const word = getWordAtPosition(doc, params.position.line, params.position.character);
  if (!word) return null;

  const resolved = resolveSymbolSet(
    index,
    word,
    uriToPath(params.textDocument.uri),
    params.position.line + 1,
  );
  if (resolved.definitions.length === 0) return null;

  const targets = getSearchTargets(index, resolved);
  const declarationKeys = new Set(
    resolved.definitions.map((symbol) => `${normalizePath(symbol.file)}:${symbol.line}`),
  );
  const locations: Location[] = [];

  for (const target of targets) {
    let lines: string[];
    try {
      lines = fs.readFileSync(target.filePath, 'latin1').split(/\r?\n/);
    } catch {
      continue;
    }

    const lastLine = Math.min(lines.length, target.lineEnd);
    for (let i = Math.max(1, target.lineStart); i <= lastLine; i++) {
      const occurrences = findIdentifierOccurrences(lines[i - 1], word);
      for (const occurrence of occurrences) {
        const key = `${normalizePath(target.filePath)}:${i}`;
        if (!params.context.includeDeclaration && declarationKeys.has(key)) {
          continue;
        }

        locations.push({
          uri: pathToUri(target.filePath),
          range: Range.create(i - 1, occurrence.start, i - 1, occurrence.end),
        });
      }
    }
  }

  return locations;
}
