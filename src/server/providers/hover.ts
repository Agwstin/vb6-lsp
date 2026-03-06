import {
  HoverParams,
  Hover,
  MarkupKind,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index, VB6Symbol } from '../indexer/types';
import { getWordAtPosition, uriToPath } from '../utils';
import { resolveSymbolSet } from '../resolution';
import { inferResolvedSymbolType } from '../typeInference';
import { getMemberAccessContext, resolveMemberSymbols } from '../memberAccess';

export function handleHover(
  params: HoverParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index
): Hover | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const memberAccess = getMemberAccessContext(doc, params.position.line, params.position.character);
  if (memberAccess && memberAccess.memberName) {
    const resolvedMember = resolveMemberSymbols(
      index,
      doc,
      uriToPath(params.textDocument.uri),
      params.position.line + 1,
      memberAccess.receiverName,
      memberAccess.memberName,
    );
    if (resolvedMember && resolvedMember.symbols.length > 0) {
      return buildHover(
        resolvedMember.symbols,
        (sym) => inferResolvedSymbolType(
          index,
          { word: sym.name, currentFile: uriToPath(params.textDocument.uri), line: params.position.line + 1, definitions: [sym] },
          uriToPath(params.textDocument.uri),
          params.position.line + 1,
          doc,
        ),
      );
    }
  }

  const word = getWordAtPosition(doc, params.position.line, params.position.character);
  if (!word) return null;

  const resolved = resolveSymbolSet(
    index,
    word,
    uriToPath(params.textDocument.uri),
    params.position.line + 1,
  );
  if (resolved.definitions.length === 0) return null;

  return buildHover(
    resolved.definitions,
    (sym) => inferResolvedSymbolType(
      index,
      { ...resolved, definitions: [sym] },
      uriToPath(params.textDocument.uri),
      params.position.line + 1,
      doc,
    ),
  );
}

function buildHover(
  symbols: VB6Symbol[],
  inferType: (symbol: VB6Symbol) => string | null,
): Hover | null {
  // Build markdown content for all matching symbols
  const parts: string[] = [];

  for (const sym of symbols) {
    const lines: string[] = [];
    const inferredType = inferType(sym);

    // Signature in code block
    lines.push('```vb');
    lines.push(sym.signature);
    lines.push('```');

    // Module and file info
    lines.push(`**Module:** \`${sym.moduleName}\` — \`${sym.relPath}\`:${sym.line}`);

    // Kind and visibility
    const scopeSuffix = sym.scope === 'module' ? '' : ` (${sym.scope})`;
    lines.push(`**${sym.visibility} ${sym.kind}${scopeSuffix}**`);

    // Return type if present
    if (sym.returnType) {
      lines.push(`**Returns:** \`${sym.returnType}\``);
    }

    if (inferredType && inferredType !== sym.returnType) {
      lines.push(`**Type:** \`${inferredType}\``);
    }

    if (sym.containerName) {
      lines.push(`**Container:** \`${sym.containerName}\``);
    }

    parts.push(lines.join('\n'));
  }

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: parts.join('\n\n---\n\n'),
    },
  };
}
