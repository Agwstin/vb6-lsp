import {
  RenameParams,
  PrepareRenameParams,
  WorkspaceEdit,
  TextEdit,
  Range,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import { VB6Index } from '../indexer/types';
import { getWordAtPosition, pathToUri, uriToPath } from '../utils';
import { findIdentifierOccurrences } from '../indexer/parser';
import { getSearchTargets, isAmbiguousPublicDefinition, resolveSymbolSet } from '../resolution';

export function handlePrepareRename(
  params: PrepareRenameParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index,
): Range | null {
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
  if (resolved.definitions.length === 0 || isAmbiguousPublicDefinition(resolved.definitions)) {
    return null;
  }

  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  const line = lines[params.position.line];
  if (!line) return null;

  let start = params.position.character;
  while (start > 0 && /[a-zA-Z0-9_]/.test(line[start - 1])) start--;
  let end = params.position.character;
  while (end < line.length && /[a-zA-Z0-9_]/.test(line[end])) end++;

  return Range.create(params.position.line, start, params.position.line, end);
}

export function handleRename(
  params: RenameParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index,
): WorkspaceEdit | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const word = getWordAtPosition(doc, params.position.line, params.position.character);
  if (!word) return null;

  if (!params.newName || params.newName === word || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(params.newName)) {
    return null;
  }

  const resolved = resolveSymbolSet(
    index,
    word,
    uriToPath(params.textDocument.uri),
    params.position.line + 1,
  );
  if (resolved.definitions.length === 0 || isAmbiguousPublicDefinition(resolved.definitions)) {
    return null;
  }

  const changes: { [uri: string]: TextEdit[] } = {};

  for (const target of getSearchTargets(index, resolved)) {
    let lines: string[];
    try {
      lines = fs.readFileSync(target.filePath, 'latin1').split(/\r?\n/);
    } catch {
      continue;
    }

    const fileUri = pathToUri(target.filePath);
    const edits: TextEdit[] = [];
    const lastLine = Math.min(lines.length, target.lineEnd);

    for (let i = Math.max(1, target.lineStart); i <= lastLine; i++) {
      const occurrences = findIdentifierOccurrences(lines[i - 1], word);
      for (const occurrence of occurrences) {
        edits.push({
          range: Range.create(i - 1, occurrence.start, i - 1, occurrence.end),
          newText: params.newName,
        });
      }
    }

    if (edits.length > 0) {
      changes[fileUri] = edits;
    }
  }

  return Object.keys(changes).length > 0 ? { changes } : null;
}
