import {
  HoverParams,
  Hover,
  MarkupKind,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index } from '../indexer/types';
import { getWordAtPosition, uriToPath } from '../utils';
import { resolveSymbolSet } from '../resolution';

export function handleHover(
  params: HoverParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index
): Hover | null {
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

  // Build markdown content for all matching symbols
  const parts: string[] = [];

  for (const sym of resolved.definitions) {
    const lines: string[] = [];

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
