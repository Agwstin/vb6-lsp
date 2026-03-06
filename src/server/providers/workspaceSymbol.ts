import {
  WorkspaceSymbolParams,
  SymbolInformation,
  SymbolKind,
  Location,
  Range,
} from 'vscode-languageserver';
import { VB6Index, VB6Symbol } from '../indexer/types';
import { pathToUri } from '../utils';

const MAX_RESULTS = 100;

export function handleWorkspaceSymbol(
  params: WorkspaceSymbolParams,
  index: VB6Index
): SymbolInformation[] {
  const query = params.query.toLowerCase();
  if (!query) return [];

  const results: SymbolInformation[] = [];

  for (const [nameKey, symbols] of index.byName) {
    if (nameKey.includes(query)) {
      for (const sym of symbols) {
        if (sym.scope !== 'module') continue;

        results.push({
          name: sym.accessor ? `${sym.name} (${sym.accessor})` : sym.name,
          kind: mapSymbolKind(sym.kind),
          location: Location.create(
            pathToUri(sym.file),
            Range.create(sym.line - 1, 0, sym.line - 1, 0)
          ),
          containerName: sym.moduleName,
        });

        if (results.length >= MAX_RESULTS) return results;
      }
    }
  }

  return results;
}

function mapSymbolKind(kind: VB6Symbol['kind']): SymbolKind {
  switch (kind) {
    case 'Sub': return SymbolKind.Method;
    case 'Function': return SymbolKind.Function;
    case 'Property': return SymbolKind.Property;
    case 'Type': return SymbolKind.Struct;
    case 'Enum': return SymbolKind.Enum;
    case 'Const': return SymbolKind.Constant;
    case 'Declare': return SymbolKind.Function;
    case 'Variable': return SymbolKind.Variable;
    case 'Event': return SymbolKind.Event;
    case 'Field': return SymbolKind.Field;
    case 'Implements': return SymbolKind.Interface;
    default: return SymbolKind.Variable;
  }
}
