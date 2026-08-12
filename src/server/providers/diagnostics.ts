import {
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver';
import * as fs from 'fs';
import * as path from 'path';
import { VB6Index, VB6Symbol } from '../indexer/types';
import { VB6ProjectReference, VB6WorkspaceConfig, findProjectsForFile } from '../config';
import {
  isCommentLine,
  SYMBOL_RE,
  DECLARE_RE,
  TYPE_RE,
  ENUM_RE,
  CONST_RE,
  VARIABLE_RE,
  EVENT_RE,
  IMPLEMENTS_RE,
  END_BLOCK_RE,
  ATTRIBUTE_RE,
  readLogicalLine,
  stripInlineComment,
  WITH_RE,
} from '../indexer/parser';
import { normalizePath } from '../utils';
import { resolveSymbolSet } from '../resolution';
import type { SourceTextProvider } from '../documentStore';

const VB6_KEYWORDS = new Set([
  'as', 'byref', 'byval', 'call', 'case', 'const', 'dim', 'do', 'each', 'else', 'elseif',
  'end', 'enum', 'event', 'exit', 'false', 'for', 'friend', 'function', 'get', 'global', 'goto',
  'if', 'implements', 'in', 'is', 'let', 'loop', 'me', 'new', 'next', 'not', 'nothing', 'on',
  'option', 'optional', 'or', 'paramarray', 'private', 'property', 'public', 'redim', 'rem',
  'resume', 'select', 'set', 'static', 'step', 'sub', 'then', 'to', 'true', 'type', 'wend',
  'while', 'with', 'withevents',
  'beep', 'chdir', 'chdrive', 'close', 'date', 'doevents', 'erase', 'filecopy', 'kill',
  'mkdir', 'name', 'open', 'print', 'randomize', 'reset', 'rmdir', 'savepicture', 'seek',
  'sendkeys', 'time', 'msgbox',
]);

const KNOWN_EXTERNAL_ROUTINES = new Set([
  'd3dcolorargb',
  'd3dcolorrgba',
  'd3dcolorxrgb',
]);

export function computeDiagnostics(
  filePath: string,
  index: VB6Index,
  workspaceConfig?: VB6WorkspaceConfig,
  source?: SourceTextProvider,
): Diagnostic[] {
  const content = source ? source.readText(filePath) : readDiskText(filePath);
  if (content === null) return [];

  const lines = content.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  const openBlocks: Array<{ kind: string; name: string; line: number }> = [];

  let hasOptionExplicit = false;
  let preprocessorDepth = 0;

  for (let indexLine = 0; indexLine < lines.length; ) {
    const logical = readLogicalLine(lines, indexLine);
    const raw = logical.text;
    const trimmed = raw.trimStart();

    if (isDesignerStatement(filePath, trimmed)) {
      indexLine = logical.endLine;
      continue;
    }

    if (!trimmed || isCommentLine(trimmed) || ATTRIBUTE_RE.test(trimmed)) {
      indexLine = logical.endLine;
      continue;
    }

    const directive = parsePreprocessorDirective(trimmed);
    if (directive) {
      if (directive === 'if') preprocessorDepth++;
      else if (directive === 'end if') preprocessorDepth = Math.max(0, preprocessorDepth - 1);
      indexLine = logical.endLine;
      continue;
    }

    if (/^Option\s+Explicit\b/i.test(trimmed)) {
      hasOptionExplicit = true;
    }

    if (SYMBOL_RE.test(trimmed) && !DECLARE_RE.test(trimmed)) {
      const match = trimmed.match(SYMBOL_RE);
      if (match) {
        const kind = match[3].toLowerCase();
        const name = match[5];
        if (!isConditionalAlternativeDeclaration(openBlocks, preprocessorDepth, kind, name)) {
          openBlocks.push({ kind, name, line: logical.startLine - 1 });
        }
      }
    }

    const typeMatch = trimmed.match(TYPE_RE);
    if (typeMatch && !hasOpenBlock(openBlocks, 'type')) {
      openBlocks.push({ kind: 'type', name: typeMatch[2], line: logical.startLine - 1 });
    }

    const enumMatch = trimmed.match(ENUM_RE);
    if (enumMatch && !hasOpenBlock(openBlocks, 'type') && !hasOpenBlock(openBlocks, 'enum')) {
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

    const withMatch = trimmed.match(WITH_RE);
    if (withMatch) {
      const receiver = withMatch[1].trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(receiver)) {
        const resolved = resolveSymbolSet(index, receiver, filePath, logical.startLine);
        if (
          resolved.definitions.length === 0 &&
          !isKnownProjectComponent(workspaceConfig, receiver, filePath) &&
          !isKnownFileMember(index, receiver, filePath)
        ) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: Range.create(logical.startLine - 1, raw.indexOf(receiver), logical.startLine - 1, raw.indexOf(receiver) + receiver.length),
            message: `Unresolved With receiver '${receiver}'`,
            source: 'vb6-lsp',
          });
        }
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
  const currentProjects = workspaceConfig ? findProjectsForFile(workspaceConfig, filePath) : [];
  const fileSymbols = index.byFile.get(normPath);
  if (fileSymbols) {
    for (const symbol of fileSymbols) {
      if (!shouldCheckDuplicatePublicSymbol(symbol)) continue;
      if (symbol.scope !== 'module' || symbol.visibility !== 'Public') continue;
      const others = index.byName.get(symbol.name.toLowerCase());
      if (!others || others.length <= 1) continue;

      const duplicates = others.filter((candidate) =>
        shouldCheckDuplicatePublicSymbol(candidate) &&
        candidate.scope === 'module' &&
        candidate.visibility === 'Public' &&
        normalizePath(candidate.file) !== normPath &&
        isDuplicateInSameProject(workspaceConfig, currentProjects, candidate.file),
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
      const missingReferences = project.references.filter((reference) =>
        reference.exists === false && shouldReportMissingProjectReference(reference),
      );
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

function readDiskText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'latin1');
  } catch {
    return null;
  }
}

function parsePreprocessorDirective(code: string): 'if' | 'else' | 'elseif' | 'end if' | null {
  const match = code.match(/^#\s*(If|ElseIf|Else|End\s+If)\b/i);
  if (!match) return null;
  return match[1].replace(/\s+/g, ' ').toLowerCase() as 'if' | 'else' | 'elseif' | 'end if';
}

function isConditionalAlternativeDeclaration(
  openBlocks: Array<{ kind: string; name: string; line: number }>,
  preprocessorDepth: number,
  kind: string,
  name: string,
): boolean {
  if (preprocessorDepth === 0) return false;
  return openBlocks.some((block) =>
    block.kind === kind &&
    block.name.toLowerCase() === name.toLowerCase(),
  );
}

function hasOpenBlock(openBlocks: Array<{ kind: string; name: string; line: number }>, kind: string): boolean {
  return openBlocks.some((block) => block.kind === kind);
}

function shouldCheckDuplicatePublicSymbol(symbol: VB6Symbol): boolean {
  if (symbol.scope !== 'module' || symbol.visibility !== 'Public') return false;

  const extension = path.extname(symbol.file).toLowerCase();
  if (extension === '.cls' || extension === '.frm' || extension === '.ctl') {
    // Public members on classes/forms are scoped by their containing type in VB6.
    return false;
  }

  return true;
}

function isDuplicateInSameProject(
  workspaceConfig: VB6WorkspaceConfig | undefined,
  currentProjects: ReturnType<typeof findProjectsForFile>,
  candidateFile: string,
): boolean {
  if (!workspaceConfig || currentProjects.length === 0) return true;

  const currentProjectFiles = new Set(currentProjects.map((project) => normalizePath(project.file)));
  return findProjectsForFile(workspaceConfig, candidateFile)
    .some((project) => currentProjectFiles.has(normalizePath(project.file)));
}

function isKnownProjectComponent(workspaceConfig: VB6WorkspaceConfig | undefined, name: string, filePath: string): boolean {
  if (!workspaceConfig) return false;
  const lower = name.toLowerCase();
  const currentProjects = findProjectsForFile(workspaceConfig, filePath);
  const projects = currentProjects.length > 0 ? currentProjects : workspaceConfig.projects;

  return projects.some((project) =>
    project.components.some((component) =>
      component.name.toLowerCase() === lower ||
      path.basename(component.path, path.extname(component.path)).toLowerCase() === lower,
    ),
  );
}

function shouldReportMissingProjectReference(reference: VB6ProjectReference): boolean {
  const libraryName = (reference.libraryName || reference.description || reference.libraryPath || '').toLowerCase();
  if (isCommonRegisteredReference(libraryName)) return false;

  const libraryPath = (reference.libraryPath || '').toLowerCase();
  if (/(^|[\\/])(windows|winnt|program files|program files \(x86\))[\\/]/i.test(libraryPath)) return false;
  if (/(^|[\\/])(system32|syswow64|common files)[\\/]/i.test(libraryPath)) return false;

  return true;
}

function isCommonRegisteredReference(value: string): boolean {
  return [
    'stdole2.tlb',
    'scrrun.dll',
    'dx8vb.dll',
    'wbemdisp.tlb',
    'winu.tlb',
    'vbscript.dll',
    'ieframe.dll',
    'mswinsck.ocx',
    'mscomctl.ocx',
    'richtx32.ocx',
    'msinet.ocx',
    'ole automation',
    'microsoft scripting runtime',
    'directx 8 for visual basic type library',
    'microsoft wmi scripting',
    'microsoft vbscript regular expressions',
    'windows api (unicode)',
  ].some((known) => value.includes(known));
}

function isDesignerBackedFile(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.frm' || extension === '.ctl';
}

function isDesignerStatement(filePath: string, code: string): boolean {
  if (!isDesignerBackedFile(filePath)) return false;
  return /^(VERSION|Object\s*=|Begin\s+[\w.]+\s+\w+|BeginProperty\b|EndProperty\b)/i.test(code);
}

function isKnownFileMember(index: VB6Index, name: string, filePath: string): boolean {
  const fileSymbols = index.byFile.get(normalizePath(filePath));
  if (!fileSymbols) return false;
  const lower = name.toLowerCase();
  return fileSymbols.some((symbol) =>
    symbol.scope === 'member' &&
    symbol.name.toLowerCase() === lower,
  );
}

function collectUnresolvedRoutineDiagnostics(
  filePath: string,
  lines: string[],
  index: VB6Index,
  diagnostics: Diagnostic[],
): void {
  const normalizedFile = normalizePath(filePath);
  let declarationBlock: 'enum' | 'type' | null = null;
  let inDesignerRegion = isDesignerBackedFile(filePath);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const code = stripInlineComment(raw).trim();
    if (!code) continue;

    if (inDesignerRegion) {
      if (ATTRIBUTE_RE.test(code)) {
        inDesignerRegion = false;
      } else {
        continue;
      }
    }

    if (isDesignerStatement(filePath, code)) continue;

    const typeMatch = code.match(TYPE_RE);
    if (typeMatch) {
      declarationBlock = 'type';
      continue;
    }

    const enumMatch = code.match(ENUM_RE);
    if (enumMatch) {
      declarationBlock = 'enum';
      continue;
    }

    const endMatch = code.match(END_BLOCK_RE);
    if (endMatch) {
      const endKind = endMatch[1].toLowerCase();
      if (declarationBlock === endKind) {
        declarationBlock = null;
      }
      continue;
    }

    if (declarationBlock || isNonRoutineDeclaration(code)) continue;

    const callMatch = code.match(/^(?:Call\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|$)/i);
    if (!callMatch) continue;

    const candidate = callMatch[1];
    const lower = candidate.toLowerCase();
    if (VB6_KEYWORDS.has(lower)) continue;
    if (KNOWN_EXTERNAL_ROUTINES.has(lower)) continue;
    if (code.startsWith('Function ') || code.startsWith('Sub ') || code.startsWith('Property ')) continue;
    if (code.startsWith('If ') || code.startsWith('For ') || code.startsWith('Do ') || code.startsWith('With ')) continue;

    // Skip array/property assignments: identifier(...) = value
    if (!code.match(/^Call\s/i) && isArrayAssignment(code)) continue;
    if (isKnownFileMember(index, candidate, filePath) && isMemberAccessAfterOptionalIndex(code, candidate)) continue;

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

function isNonRoutineDeclaration(code: string): boolean {
  return ATTRIBUTE_RE.test(code) ||
    DECLARE_RE.test(code) ||
    SYMBOL_RE.test(code) ||
    CONST_RE.test(code) ||
    VARIABLE_RE.test(code) ||
    EVENT_RE.test(code) ||
    IMPLEMENTS_RE.test(code);
}

/**
 * Detect array/property access patterns like `MyArray(index) = value`
 * or `MyArray(index).Member = value`.
 * Walks parentheses to find the matching `)`, then checks for `=` or `.`.
 */
function isArrayAssignment(code: string): boolean {
  const m = code.match(/^[A-Za-z_]\w*\s*\(/);
  if (!m) return false;
  let depth = 1;
  for (let i = m[0].length; i < code.length; i++) {
    if (code[i] === '"') {
      i++;
      while (i < code.length && code[i] !== '"') i++;
      continue;
    }
    if (code[i] === '(') depth++;
    else if (code[i] === ')') {
      depth--;
      if (depth === 0) {
        return /^\s*[.=]/.test(code.slice(i + 1));
      }
    }
  }
  return false;
}

function isMemberAccessAfterOptionalIndex(code: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const direct = new RegExp(`^(?:Call\\s+)?${escaped}\\s*\\.`, 'i');
  if (direct.test(code)) return true;

  const indexed = new RegExp(`^(?:Call\\s+)?${escaped}\\s*\\(`, 'i');
  const match = code.match(indexed);
  if (!match) return false;

  let depth = 1;
  for (let index = match[0].length; index < code.length; index++) {
    if (code[index] === '"') {
      index++;
      while (index < code.length && code[index] !== '"') index++;
      continue;
    }
    if (code[index] === '(') depth++;
    else if (code[index] === ')') {
      depth--;
      if (depth === 0) {
        return /^\s*\./.test(code.slice(index + 1));
      }
    }
  }
  return false;
}
