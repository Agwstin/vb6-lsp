import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver';
import * as fs from 'fs';
import { VB6Index } from '../indexer/types';
import { VB6WorkspaceConfig, findProjectsForFile } from '../config';
import {
  isCommentLine,
  SYMBOL_RE,
  DECLARE_RE,
  TYPE_RE,
  ENUM_RE,
  END_BLOCK_RE,
  ATTRIBUTE_RE,
  readLogicalLine,
  stripInlineComment,
} from '../indexer/parser';
import { normalizePath } from '../utils';
import { resolveSymbolSet } from '../resolution';

const VB6_KEYWORDS = new Set([
  'as', 'byref', 'byval', 'call', 'case', 'const', 'dim', 'do', 'each', 'else', 'elseif',
  'end', 'enum', 'event', 'exit', 'false', 'for', 'friend', 'function', 'get', 'global', 'goto',
  'if', 'implements', 'in', 'is', 'let', 'loop', 'me', 'new', 'next', 'not', 'nothing', 'on',
  'option', 'optional', 'or', 'paramarray', 'private', 'property', 'public', 'redim', 'rem',
  'resume', 'select', 'set', 'static', 'step', 'sub', 'then', 'to', 'true', 'type', 'wend',
  'while', 'with', 'withevents',
]);

export function computeDiagnostics(filePath: string, index: VB6Index, workspaceConfig?: VB6WorkspaceConfig): Diagnostic[] {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'latin1');
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  const openBlocks: Array<{ kind: string; name: string; line: number }> = [];

  let hasOptionExplicit = false;

  for (let indexLine = 0; indexLine < lines.length; ) {
    const logical = readLogicalLine(lines, indexLine);
    const raw = logical.text;
    const trimmed = raw.trimStart();

    if (!trimmed || isCommentLine(trimmed) || ATTRIBUTE_RE.test(trimmed)) {
      indexLine = logical.endLine;
      continue;
    }

    if (/^Option\s+Explicit\b/i.test(trimmed)) {
      hasOptionExplicit = true;
    }

    if (SYMBOL_RE.test(trimmed) && !DECLARE_RE.test(trimmed)) {
      const match = trimmed.match(SYMBOL_RE);
      if (match) {
        openBlocks.push({ kind: match[3].toLowerCase(), name: match[5], line: logical.startLine - 1 });
      }
    }

    const typeMatch = trimmed.match(TYPE_RE);
    if (typeMatch) {
      openBlocks.push({ kind: 'type', name: typeMatch[2], line: logical.startLine - 1 });
    }

    const enumMatch = trimmed.match(ENUM_RE);
    if (enumMatch) {
      openBlocks.push({ kind: 'enum', name: enumMatch[2], line: logical.startLine - 1 });
    }

    const endMatch = trimmed.match(END_BLOCK_RE);
    if (endMatch) {
      const endKind = endMatch[1].toLowerCase();
      let found = false;

      for (let cursor = openBlocks.length - 1; cursor >= 0; cursor--) {
        if (openBlocks[cursor].kind === endKind) {
          openBlocks.splice(cursor, 1);
          found = true;
          break;
        }
      }

      if (!found) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: Range.create(logical.startLine - 1, 0, logical.startLine - 1, trimmed.length),
          message: `Unexpected End ${endMatch[1]} without matching ${endMatch[1]}`,
          source: 'vb6-lsp',
        });
      }
    }

    indexLine = logical.endLine;
  }

  collectUnresolvedRoutineDiagnostics(filePath, lines, index, diagnostics);

  if (!hasOptionExplicit) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: Range.create(0, 0, 0, 0),
      message: 'Missing Option Explicit',
      source: 'vb6-lsp',
    });
  }

  for (const block of openBlocks) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(block.line, 0, block.line, lines[block.line]?.length ?? 0),
      message: `Missing End ${block.kind.charAt(0).toUpperCase() + block.kind.slice(1)} for '${block.name}'`,
      source: 'vb6-lsp',
    });
  }

  const normPath = normalizePath(filePath);
  const fileSymbols = index.byFile.get(normPath);
  if (fileSymbols) {
    for (const symbol of fileSymbols) {
      if (symbol.scope !== 'module' || symbol.visibility !== 'Public') continue;
      const others = index.byName.get(symbol.name.toLowerCase());
      if (!others || others.length <= 1) continue;

      const duplicates = others.filter((candidate) =>
        candidate.scope === 'module' &&
        candidate.visibility === 'Public' &&
        normalizePath(candidate.file) !== normPath,
      );
      if (duplicates.length === 0) continue;

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: Range.create(symbol.line - 1, 0, symbol.line - 1, symbol.name.length),
        message: `Duplicate Public symbol '${symbol.name}' also defined in: ${duplicates.map((item) => item.moduleName).join(', ')}`,
        source: 'vb6-lsp',
      });
    }
  }

  if (workspaceConfig) {
    const projects = findProjectsForFile(workspaceConfig, filePath);
    for (const project of projects) {
      const missingReferences = project.references.filter((reference) => reference.exists === false);
      for (const reference of missingReferences) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: Range.create(0, 0, 0, 0),
          message: `Missing project reference '${reference.libraryName || reference.description || reference.raw}'`,
          source: 'vb6-lsp',
        });
      }
    }
  }

  return diagnostics;
}

function collectUnresolvedRoutineDiagnostics(
  filePath: string,
  lines: string[],
  index: VB6Index,
  diagnostics: Diagnostic[],
): void {
  const normalizedFile = normalizePath(filePath);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = stripInlineComment(raw).trim();
    if (!code) continue;

    const callMatch = code.match(/^(?:Call\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|$)/i);
    if (!callMatch) continue;

    const candidate = callMatch[1];
    const lower = candidate.toLowerCase();
    if (VB6_KEYWORDS.has(lower)) continue;
    if (code.startsWith('Function ') || code.startsWith('Sub ') || code.startsWith('Property ')) continue;
    if (code.startsWith('If ') || code.startsWith('For ') || code.startsWith('Do ') || code.startsWith('With ')) continue;

    const resolved = resolveSymbolSet(index, candidate, filePath, i + 1);
    if (resolved.definitions.length > 0) continue;

    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: Range.create(i, raw.indexOf(candidate), i, raw.indexOf(candidate) + candidate.length),
      message: `Unresolved routine '${candidate}'`,
      source: 'vb6-lsp',
    });
  }
}
