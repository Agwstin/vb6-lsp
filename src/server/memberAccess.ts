import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index, VB6Symbol } from './indexer/types';
import { resolveSymbolSet } from './resolution';
import { inferResolvedSymbolType } from './typeInference';
import { stripInlineComment, WITH_RE, END_WITH_RE } from './indexer/parser';

export interface MemberAccessContext {
  receiverName: string;
  memberName: string;
  memberPrefix: string;
}

export function getMemberAccessContext(
  document: TextDocument,
  line: number,
  character: number,
): MemberAccessContext | null {
  const lines = document.getText().split(/\r?\n/);
  const lineText = lines[line];
  if (!lineText) return null;

  const cursor = Math.min(character, lineText.length);
  const explicit = parseExplicitMemberAccess(lineText, cursor);
  if (explicit) return explicit;

  const withReceiver = findActiveWithReceiver(lines, line);
  if (!withReceiver) return null;

  const implicit = parseImplicitWithMemberAccess(lineText, cursor);
  if (!implicit) return null;

  return {
    receiverName: withReceiver,
    memberName: implicit.memberName,
    memberPrefix: implicit.memberPrefix,
  };
}

export function resolveMemberSymbols(
  index: VB6Index,
  document: TextDocument,
  currentFile: string,
  line: number,
  receiverName: string,
  memberName?: string,
): { typeName: string; symbols: VB6Symbol[] } | null {
  const receiverResolved = resolveSymbolSet(index, receiverName, currentFile, line);
  const inferredType = inferResolvedSymbolType(index, receiverResolved, currentFile, line, document);
  const typeName = inferredType || receiverName;
  const symbols = getSymbolsForType(index, typeName, memberName);

  if (symbols.length === 0) {
    return null;
  }

  return {
    typeName,
    symbols,
  };
}

export function getSymbolsForType(index: VB6Index, typeName: string, memberName?: string): VB6Symbol[] {
  const lowerType = typeName.toLowerCase();
  const lowerMember = memberName?.toLowerCase();

  return index.byName.size > 0
    ? [...index.byName.values()]
        .flat()
        .filter((symbol) => {
          if (lowerMember && symbol.name.toLowerCase() !== lowerMember) return false;
          if (symbol.scope === 'member' && symbol.containerName?.toLowerCase() === lowerType) return true;
          if (symbol.scope === 'module' && symbol.moduleName.toLowerCase() === lowerType) {
            return symbol.kind !== 'Type' && symbol.kind !== 'Enum' && symbol.kind !== 'Implements';
          }
          return false;
        })
    : [];
}

function parseExplicitMemberAccess(lineText: string, character: number): MemberAccessContext | null {
  let cursor = character;
  let memberEnd = cursor;
  let memberStart = cursor;

  while (memberStart > 0 && /[A-Za-z0-9_]/.test(lineText[memberStart - 1])) {
    memberStart--;
  }

  const memberPrefix = lineText.substring(memberStart, memberEnd);
  cursor = memberStart;

  while (cursor > 0 && /\s/.test(lineText[cursor - 1])) {
    cursor--;
  }

  if (cursor <= 0 || lineText[cursor - 1] !== '.') {
    return null;
  }

  let receiverEnd = cursor - 1;
  while (receiverEnd > 0 && /\s/.test(lineText[receiverEnd - 1])) {
    receiverEnd--;
  }

  let receiverStart = receiverEnd;
  while (receiverStart > 0 && /[A-Za-z0-9_]/.test(lineText[receiverStart - 1])) {
    receiverStart--;
  }

  const receiverName = lineText.substring(receiverStart, receiverEnd);
  if (!receiverName) return null;

  return {
    receiverName,
    memberName: memberPrefix,
    memberPrefix,
  };
}

function parseImplicitWithMemberAccess(lineText: string, character: number): Pick<MemberAccessContext, 'memberName' | 'memberPrefix'> | null {
  let cursor = character;
  let memberEnd = cursor;
  let memberStart = cursor;

  while (memberStart > 0 && /[A-Za-z0-9_]/.test(lineText[memberStart - 1])) {
    memberStart--;
  }

  const memberPrefix = lineText.substring(memberStart, memberEnd);
  cursor = memberStart;

  while (cursor > 0 && /\s/.test(lineText[cursor - 1])) {
    cursor--;
  }

  const trimmedLeading = lineText.substring(0, cursor).trimStart();
  if (!trimmedLeading.startsWith('.')) {
    return null;
  }

  return {
    memberName: memberPrefix,
    memberPrefix,
  };
}

function findActiveWithReceiver(lines: string[], currentLine: number): string | null {
  let depth = 0;

  for (let line = currentLine; line >= 0; line--) {
    const statement = stripInlineComment(lines[line] || '').trim();
    if (!statement) continue;

    if (END_WITH_RE.test(statement)) {
      depth++;
      continue;
    }

    const withMatch = statement.match(WITH_RE);
    if (withMatch) {
      if (depth === 0) {
        return withMatch[1].trim();
      }
      depth--;
    }
  }

  return null;
}
