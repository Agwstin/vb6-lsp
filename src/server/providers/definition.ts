import {
  DefinitionParams,
  Location,
  Range,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index } from '../indexer/types';
import { getWordAtPosition, pathToUri, uriToPath } from '../utils';
import { resolveSymbolSet } from '../resolution';
import { getMemberAccessContext, resolveMemberSymbols } from '../memberAccess';

export function handleDefinition(
  params: DefinitionParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index
): Location[] | null {
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
      return resolvedMember.symbols.map((sym) => ({
        uri: pathToUri(sym.file),
        range: Range.create(sym.line - 1, 0, sym.line - 1, 0),
      }));
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

  return resolved.definitions.map((sym) => ({
    uri: pathToUri(sym.file),
    range: Range.create(sym.line - 1, 0, sym.line - 1, 0),
  }));
}
