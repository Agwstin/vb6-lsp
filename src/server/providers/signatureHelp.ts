import {
  SignatureHelpParams,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Index } from '../indexer/types';
import { uriToPath } from '../utils';
import { resolveSymbolSet } from '../resolution';
import { resolveMemberSymbols } from '../memberAccess';

export function handleSignatureHelp(
  params: SignatureHelpParams,
  documents: { get(uri: string): TextDocument | undefined },
  index: VB6Index
): SignatureHelp | null {
  const doc = documents.get(params.textDocument.uri);
  if (!doc) return null;

  const text = doc.getText();
  const offset = doc.offsetAt(params.position);

  // Walk backwards to find the function name before the opening paren
  const { funcName, receiverName, activeParam } = findFunctionContext(text, offset);
  if (!funcName) return null;

  const resolved = receiverName
    ? resolveMemberSymbols(
        index,
        doc,
        uriToPath(params.textDocument.uri),
        params.position.line + 1,
        receiverName,
        funcName,
      )
    : null;

  const symbols = resolved
    ? resolved.symbols
    : resolveSymbolSet(
        index,
        funcName,
        uriToPath(params.textDocument.uri),
        params.position.line + 1,
      ).definitions;
  if (symbols.length === 0) return null;

  const signatures: SignatureInformation[] = [];

  for (const sym of symbols) {
    if (sym.params.length === 0 && sym.kind !== 'Sub' && sym.kind !== 'Function' && sym.kind !== 'Declare') {
      continue;
    }

    const paramInfos: ParameterInformation[] = sym.params.map(p => {
      let label = '';
      if (p.passing) label += p.passing + ' ';
      if (p.optional) label = 'Optional ' + label;
      label += p.name;
      if (p.type && p.type !== 'Variant') label += ' As ' + p.type;
      if (p.defaultValue) label += ' = ' + p.defaultValue;

      return ParameterInformation.create(label);
    });

    const sigLabel = `${sym.name}(${paramInfos.map(p => typeof p.label === 'string' ? p.label : '').join(', ')})`;
    const sigInfo = SignatureInformation.create(
      sym.returnType ? `${sigLabel} As ${sym.returnType}` : sigLabel,
      undefined,
      ...paramInfos,
    );

    signatures.push(sigInfo);
  }

  if (signatures.length === 0) return null;

  return {
    signatures,
    activeSignature: 0,
    activeParameter: activeParam,
  };
}

/**
 * Walk backwards from cursor to find function name and active parameter index.
 */
function findFunctionContext(text: string, offset: number): { funcName: string | null; receiverName: string | null; activeParam: number } {
  let depth = 0;
  let commaCount = 0;
  let inString = false;

  for (let i = offset - 1; i >= 0; i--) {
    const ch = text[i];

    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === ')') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        // Found our opening paren — extract function name
        let nameEnd = i;
        // Skip whitespace before paren
        while (nameEnd > 0 && /\s/.test(text[nameEnd - 1])) nameEnd--;

        let nameStart = nameEnd;
        while (nameStart > 0 && /[a-zA-Z0-9_]/.test(text[nameStart - 1])) {
          nameStart--;
        }

        const funcName = text.substring(nameStart, nameEnd);
        let receiverName = null;
        let receiverCursor = nameStart;
        while (receiverCursor > 0 && /\s/.test(text[receiverCursor - 1])) receiverCursor--;
        if (receiverCursor > 0 && text[receiverCursor - 1] === '.') {
          receiverCursor--;
          while (receiverCursor > 0 && /\s/.test(text[receiverCursor - 1])) receiverCursor--;
          let receiverStart = receiverCursor;
          while (receiverStart > 0 && /[a-zA-Z0-9_]/.test(text[receiverStart - 1])) {
            receiverStart--;
          }
          receiverName = text.substring(receiverStart, receiverCursor) || null;
        }

        return { funcName: funcName || null, receiverName, activeParam: commaCount };
      }
      depth--;
    } else if (ch === ',' && depth === 0) {
      commaCount++;
    } else if (ch === '\n' || ch === '\r') {
      // Check if previous line ends with _ (line continuation)
      let lineEnd = i;
      if (ch === '\n' && i > 0 && text[i - 1] === '\r') lineEnd = i - 1;
      // Look back for _
      let checkPos = lineEnd - 1;
      while (checkPos >= 0 && text[checkPos] === ' ') checkPos--;
      if (checkPos < 0 || text[checkPos] !== '_') {
        // Not a continuation — stop searching
        return { funcName: null, receiverName: null, activeParam: 0 };
      }
    }
  }

  return { funcName: null, receiverName: null, activeParam: 0 };
}
