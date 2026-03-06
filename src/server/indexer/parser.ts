import { VB6Parameter } from './types';

// ============================================================
// REGEX PATTERNS
// ============================================================

/**
 * Matches Sub, Function, Property Get/Let/Set declarations.
 * Groups: 1=visibility, 2=static, 3=kind (Sub|Function|Property), 4=prop accessor, 5=name, 6=params+rest
 */
export const SYMBOL_RE = /^(?:(?:(Public|Private|Friend)\s+)?(?:(Static)\s+)?(Sub|Function|Property)\s+(Get\s+|Let\s+|Set\s+)?(\w+)\s*(\(.*)?$)/i;

/**
 * Matches Declare (API) statements.
 * Groups: 1=visibility, 2=Sub|Function, 3=name
 */
export const DECLARE_RE = /^(?:(Public|Private)\s+)?Declare\s+(?:PtrSafe\s+)?(Sub|Function)\s+(\w+)\s+Lib\s+/i;

/**
 * Matches Type declarations.
 * Groups: 1=visibility, 2=name
 */
export const TYPE_RE = /^(?:(Public|Private)\s+)?Type\s+(\w+)/i;

/**
 * Matches Enum declarations.
 * Groups: 1=visibility, 2=name
 */
export const ENUM_RE = /^(?:(Public|Private)\s+)?Enum\s+(\w+)/i;

/**
 * Matches Const declarations (both module-level and local).
 * Groups: 1=visibility, 2=name
 */
export const CONST_RE = /^(?:(Public|Private|Global)\s+)?Const\s+(\w+)/i;

/**
 * Matches a potential variable declaration statement. Individual identifiers are parsed separately.
 */
export const VARIABLE_RE = /^(Public|Private|Dim|Global|Static)\s+/i;

/**
 * Matches Event declarations.
 * Groups: 1=visibility, 2=name
 */
export const EVENT_RE = /^(?:(Public|Private)\s+)?Event\s+(\w+)/i;

/**
 * Matches Implements statements in class modules.
 */
export const IMPLEMENTS_RE = /^Implements\s+([\w.]+)/i;

/**
 * Matches End Sub/Function/Property/Type/Enum
 */
export const END_BLOCK_RE = /^End\s+(Sub|Function|Property|Type|Enum)\b/i;

/**
 * Matches Attribute VB_Name = "ModuleName"
 */
export const VB_NAME_RE = /^Attribute\s+VB_Name\s*=\s*"([^"]+)"/i;

/**
 * Matches any other VB attribute line.
 */
export const ATTRIBUTE_RE = /^Attribute\s+/i;

export interface LogicalLine {
  text: string;
  startLine: number;
  endLine: number;
}

export interface VariableDeclaration {
  visibilityKeyword: 'Public' | 'Private' | 'Dim' | 'Global' | 'Static';
  name: string;
  type: string;
  withEvents: boolean;
}

export interface TypeFieldDeclaration {
  name: string;
  type: string;
}

export interface IdentifierOccurrence {
  name: string;
  start: number;
  end: number;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if a line is a comment (starts with ' or Rem after trimming).
 */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("'") || /^Rem\s/i.test(trimmed);
}

export function stripInlineComment(line: string): string {
  let inString = false;

  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inString && line[i + 1] === '"') {
        i++;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (line[i] === "'" && !inString) {
      return line.substring(0, i);
    }
  }

  return line;
}

export function isPositionInCommentOrString(line: string, character: number): boolean {
  let inString = false;

  for (let i = 0; i < line.length && i < character; i++) {
    if (line[i] === '"') {
      if (inString && line[i + 1] === '"') {
        i++;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (line[i] === "'" && !inString) {
      return true;
    }
  }

  return inString;
}

export function findIdentifierOccurrences(line: string, name?: string): IdentifierOccurrence[] {
  const occurrences: IdentifierOccurrence[] = [];
  const codeOnly = stripInlineComment(line);
  let inString = false;
  let current = '';
  let currentStart = -1;
  const target = name ? name.toLowerCase() : null;

  const flush = (endIndex: number) => {
    if (!current) return;
    if (!target || current.toLowerCase() === target) {
      occurrences.push({ name: current, start: currentStart, end: endIndex });
    }
    current = '';
    currentStart = -1;
  };

  for (let i = 0; i < codeOnly.length; i++) {
    const ch = codeOnly[i];

    if (ch === '"') {
      if (inString && codeOnly[i + 1] === '"') {
        i++;
        continue;
      }
      flush(i);
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (/[A-Za-z0-9_]/.test(ch)) {
      if (!current) currentStart = i;
      current += ch;
      continue;
    }

    flush(i);
  }

  flush(codeOnly.length);
  return occurrences;
}

export function readLogicalLine(lines: string[], startIndex: number): LogicalLine {
  let text = lines[startIndex] ?? '';
  let endIndex = startIndex;

  while (hasLineContinuation(text) && endIndex + 1 < lines.length) {
    text = trimLineContinuation(text) + ' ' + lines[endIndex + 1].trim();
    endIndex++;
  }

  return {
    text,
    startLine: startIndex + 1,
    endLine: endIndex + 1,
  };
}

function hasLineContinuation(line: string): boolean {
  const codeOnly = stripInlineComment(line).replace(/\s+$/, '');
  return codeOnly.endsWith('_');
}

function trimLineContinuation(line: string): string {
  return stripInlineComment(line).replace(/\s*_\s*$/, '').trimEnd();
}

/**
 * Parse the parameter list from a Sub/Function signature.
 * Input: "(ByVal x As Integer, Optional y As String = "")" or partial
 */
export function parseParameters(paramString: string | undefined): VB6Parameter[] {
  if (!paramString) return [];

  let inner = paramString.trim();
  if (inner.startsWith('(')) inner = inner.substring(1);

  const closeParen = findMatchingParen(inner);
  if (closeParen >= 0) {
    inner = inner.substring(0, closeParen);
  } else if (inner.endsWith(')')) {
    inner = inner.slice(0, -1);
  }

  if (!inner.trim()) return [];

  return splitCommaAware(inner)
    .map((part) => parseSingleParam(part.trim()))
    .filter((param): param is VB6Parameter => Boolean(param));
}

/**
 * Extract the return type from after the closing paren of a Function/Property Get.
 * E.g. "(x As Integer) As String" → "String"
 */
export function parseReturnType(rest: string | undefined): string {
  if (!rest) return '';

  const closeParen = rest.lastIndexOf(')');
  if (closeParen < 0) return '';

  const afterParen = rest.substring(closeParen + 1);
  const asMatch = afterParen.match(/\bAs\s+([\w.]+)/i);
  return asMatch ? asMatch[1] : '';
}

/**
 * Build a full signature string from the raw line.
 */
export function buildSignature(line: string): string {
  return stripInlineComment(line).trim().replace(/\s+/g, ' ');
}

export function parseVariableDeclarations(statement: string): VariableDeclaration[] {
  const headerMatch = statement.match(/^(Public|Private|Dim|Global|Static)\s+(.*)$/i);
  if (!headerMatch) return [];

  const visibilityKeyword = normalizeVisibilityKeyword(headerMatch[1]);
  let rest = headerMatch[2].trim();
  let withEvents = false;

  if (/^WithEvents\s+/i.test(rest)) {
    withEvents = true;
    rest = rest.replace(/^WithEvents\s+/i, '');
  }

  return splitCommaAware(rest)
    .map((part) => parseSingleVariablePart(part.trim(), visibilityKeyword, withEvents))
    .filter((item): item is VariableDeclaration => Boolean(item));
}

export function parseTypeFieldDeclaration(statement: string): TypeFieldDeclaration | null {
  const code = stripInlineComment(statement).trim();
  if (!code || /^(Public|Private|Friend|Dim|Global|Static)\b/i.test(code)) {
    return null;
  }

  const match = code.match(/^(\w+)(?:\(.*?\))?\s*(?:As\s+(?:New\s+)?([\w.]+))?$/i);
  if (!match) return null;

  return {
    name: match[1],
    type: match[2] || 'Variant',
  };
}

export function splitCommaAware(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    if (ch === '"') {
      current += ch;
      if (inString && value[i + 1] === '"') {
        current += value[i + 1];
        i++;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === '(') depth++;
      else if (ch === ')' && depth > 0) depth--;

      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }

    current += ch;
  }

  if (current.trim()) parts.push(current);
  return parts;
}

function parseSingleParam(raw: string): VB6Parameter | null {
  if (!raw) return null;

  let s = raw.trim();
  let optional = false;
  let passing: 'ByVal' | 'ByRef' | '' = '';
  let defaultValue = '';

  if (/^Optional\s+/i.test(s)) {
    optional = true;
    s = s.replace(/^Optional\s+/i, '');
  }

  if (/^ParamArray\s+/i.test(s)) {
    s = s.replace(/^ParamArray\s+/i, '');
  }

  if (/^ByVal\s+/i.test(s)) {
    passing = 'ByVal';
    s = s.replace(/^ByVal\s+/i, '');
  } else if (/^ByRef\s+/i.test(s)) {
    passing = 'ByRef';
    s = s.replace(/^ByRef\s+/i, '');
  }

  const eqIdx = s.indexOf('=');
  if (eqIdx >= 0) {
    defaultValue = s.substring(eqIdx + 1).trim();
    s = s.substring(0, eqIdx).trim();
  }

  const asMatch = s.match(/^(\w+)(?:\(.*?\))?\s+As\s+(?:New\s+)?([\w.]+)/i);
  if (asMatch) {
    return { name: asMatch[1], type: asMatch[2], passing, optional, defaultValue };
  }

  const nameMatch = s.match(/^(\w+)/);
  if (nameMatch) {
    return { name: nameMatch[1], type: 'Variant', passing, optional, defaultValue };
  }

  return null;
}

function parseSingleVariablePart(
  raw: string,
  visibilityKeyword: VariableDeclaration['visibilityKeyword'],
  withEvents: boolean,
): VariableDeclaration | null {
  if (!raw) return null;

  const withoutDefault = raw.split('=')[0].trim();
  const match = withoutDefault.match(/^(\w+)(?:\(.*?\))?\s*(?:As\s+(?:New\s+)?([\w.]+))?$/i);
  if (!match) return null;

  return {
    visibilityKeyword,
    name: match[1],
    type: match[2] || 'Variant',
    withEvents,
  };
}

function normalizeVisibilityKeyword(value: string): VariableDeclaration['visibilityKeyword'] {
  const normalized = value.toLowerCase();
  if (normalized === 'public') return 'Public';
  if (normalized === 'private') return 'Private';
  if (normalized === 'global') return 'Global';
  if (normalized === 'static') return 'Static';
  return 'Dim';
}

function findMatchingParen(value: string): number {
  let depth = 0;

  for (let i = 0; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}
