import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import * as path from 'path';
import { isPositionInCommentOrString } from './indexer/parser';

/**
 * Get the word at a given position in a text document.
 * VB6 identifiers: [a-zA-Z_][a-zA-Z0-9_]*
 */
export function getWordAtPosition(doc: TextDocument, line: number, character: number): string | null {
  const text = doc.getText();
  const lines = text.split(/\r?\n/);
  if (line >= lines.length) return null;

  const lineText = lines[line];
  if (character > lineText.length) return null;
  if (isPositionInCommentOrString(lineText, character)) return null;

  // Expand left
  let start = character;
  while (start > 0 && /[a-zA-Z0-9_]/.test(lineText[start - 1])) {
    start--;
  }

  // Expand right
  let end = character;
  while (end < lineText.length && /[a-zA-Z0-9_]/.test(lineText[end])) {
    end++;
  }

  if (start === end) return null;
  return lineText.substring(start, end);
}

/**
 * Get the word at position from raw file lines.
 */
export function getWordAtPositionFromLines(lines: string[], line: number, character: number): string | null {
  if (line >= lines.length) return null;

  const lineText = lines[line];
  if (character > lineText.length) return null;
  if (isPositionInCommentOrString(lineText, character)) return null;

  let start = character;
  while (start > 0 && /[a-zA-Z0-9_]/.test(lineText[start - 1])) {
    start--;
  }

  let end = character;
  while (end < lineText.length && /[a-zA-Z0-9_]/.test(lineText[end])) {
    end++;
  }

  if (start === end) return null;
  return lineText.substring(start, end);
}

export function uriToPath(uri: string): string {
  return URI.parse(uri).fsPath;
}

export function pathToUri(filePath: string): string {
  return URI.file(filePath).toString();
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize a path for consistent map keys (lowercase on Windows).
 */
export function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase();
}
