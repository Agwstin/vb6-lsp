import {
  FoldingRange,
  FoldingRangeKind,
  FoldingRangeParams,
} from 'vscode-languageserver';
import { VB6Index } from '../indexer/types';
import { uriToPath, normalizePath } from '../utils';

export function handleFoldingRanges(
  params: FoldingRangeParams,
  index: VB6Index,
): FoldingRange[] {
  const filePath = normalizePath(uriToPath(params.textDocument.uri));
  const symbols = index.byFile.get(filePath) || [];

  return symbols
    .filter((symbol) => symbol.endLine > symbol.line)
    .map((symbol) => ({
      startLine: symbol.line - 1,
      endLine: symbol.endLine - 1,
      kind: FoldingRangeKind.Region,
    }));
}
