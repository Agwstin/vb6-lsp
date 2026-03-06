export interface VB6Parameter {
  name: string;
  type: string;
  passing: 'ByVal' | 'ByRef' | '';
  optional: boolean;
  defaultValue: string;
}

export type VB6SymbolKind =
  | 'Sub'
  | 'Function'
  | 'Property'
  | 'Type'
  | 'Enum'
  | 'Const'
  | 'Declare'
  | 'Variable'
  | 'Event'
  | 'Parameter';

export type VB6SymbolScope = 'module' | 'local' | 'parameter';

export interface VB6Symbol {
  name: string;
  kind: VB6SymbolKind;
  visibility: 'Public' | 'Private' | 'Friend';
  scope: VB6SymbolScope;
  moduleName: string;
  file: string;        // absolute path
  relPath: string;     // for display
  line: number;        // 1-based
  endLine: number;
  signature: string;
  params: VB6Parameter[];
  returnType: string;
  accessor?: 'Get' | 'Let' | 'Set';
  containerName?: string;
  containerKind?: 'Sub' | 'Function' | 'Property';
  containerLine?: number;
}

export interface VB6Index {
  /** All symbols keyed by lowercase name → array of symbols (multiple modules can define same name) */
  byName: Map<string, VB6Symbol[]>;
  /** All symbols for a given file (absolute path) */
  byFile: Map<string, VB6Symbol[]>;
  /** All indexed files */
  files: Set<string>;
}

export interface BodyRange {
  startLine: number;
  endLine: number;
}

export interface RoutineContext {
  name: string;
  kind: 'Sub' | 'Function' | 'Property';
  visibility: 'Public' | 'Private' | 'Friend';
  accessor?: 'Get' | 'Let' | 'Set';
  line: number;
  endLine: number;
  signature: string;
  params: VB6Parameter[];
  returnType: string;
}
