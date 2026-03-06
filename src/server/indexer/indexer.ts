import * as fs from 'fs';
import * as path from 'path';
import {
  VB6Symbol,
  VB6Index,
  RoutineContext,
} from './types';
import {
  SYMBOL_RE,
  DECLARE_RE,
  TYPE_RE,
  ENUM_RE,
  CONST_RE,
  VARIABLE_RE,
  EVENT_RE,
  IMPLEMENTS_RE,
  BEGIN_CONTROL_RE,
  END_BLOCK_RE,
  VB_NAME_RE,
  ATTRIBUTE_RE,
  isCommentLine,
  parseParameters,
  parseReturnType,
  buildSignature,
  readLogicalLine,
  parseVariableDeclarations,
  parseTypeFieldDeclaration,
} from './parser';
import { normalizePath } from '../utils';

export class VB6Indexer {
  private index: VB6Index = {
    byName: new Map(),
    byFile: new Map(),
    files: new Set(),
  };

  private rootDir: string;
  private sourceDirs: string[];

  constructor(rootDir: string, sourceDirs: string[]) {
    this.rootDir = rootDir;
    this.sourceDirs = sourceDirs;
  }

  getIndex(): VB6Index {
    return this.index;
  }

  buildFullIndex(): number {
    let totalSymbols = 0;

    for (const dir of this.sourceDirs) {
      if (!fs.existsSync(dir)) continue;

      const files = this.collectFiles(dir);
      for (const file of files) {
        const symbols = this.indexFile(file);
        totalSymbols += symbols.length;
      }
    }

    return totalSymbols;
  }

  rebuildFile(filePath: string): void {
    this.removeFile(filePath);

    if (fs.existsSync(filePath)) {
      this.indexFile(filePath);
    }
  }

  removeFile(filePath: string): void {
    const normPath = normalizePath(filePath);
    const oldSymbols = this.index.byFile.get(normPath);

    if (oldSymbols) {
      for (const symbol of oldSymbols) {
        const nameKey = symbol.name.toLowerCase();
        const bucket = this.index.byName.get(nameKey);
        if (!bucket) continue;

        const filtered = bucket.filter((candidate) => normalizePath(candidate.file) !== normPath);
        if (filtered.length > 0) this.index.byName.set(nameKey, filtered);
        else this.index.byName.delete(nameKey);
      }

      this.index.byFile.delete(normPath);
    }

    this.index.files.delete(normPath);
  }

  getFiles(): string[] {
    return Array.from(this.index.files);
  }

  private collectFiles(dir: string): string[] {
    const results: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'out') continue;
          results.push(...this.collectFiles(full));
        } else if (/\.(bas|cls|frm)$/i.test(entry.name)) {
          results.push(full);
        }
      }
    } catch {
      return results;
    }

    return results;
  }

  private indexFile(filePath: string): VB6Symbol[] {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'latin1');
    } catch {
      return [];
    }

    const lines = content.split(/\r?\n/);
    const normPath = normalizePath(filePath);
    const relPath = path.relative(this.rootDir, filePath).replace(/\\/g, '/');
    const moduleName = this.detectModuleName(filePath, lines);
    const fileExtension = path.extname(filePath).toLowerCase();
    const routines = this.collectRoutines(lines);
    const routinesByLine = new Map<number, RoutineContext>(routines.map((routine) => [routine.line, routine]));

    const symbols: VB6Symbol[] = [];
    let openTypeSymbol: VB6Symbol | null = null;
    let openEnumSymbol: VB6Symbol | null = null;

    for (let index = 0; index < lines.length; ) {
      const logical = readLogicalLine(lines, index);
      const statement = logical.text.trimStart();
      const lineNum = logical.startLine;

      if (!statement || isCommentLine(statement) || ATTRIBUTE_RE.test(statement)) {
        index = logical.endLine;
        continue;
      }

      if (VB_NAME_RE.test(statement)) {
        index = logical.endLine;
        continue;
      }

      const routine = routinesByLine.get(lineNum);
      if (routine) {
        symbols.push({
          name: routine.name,
          kind: routine.kind,
          visibility: routine.visibility,
          scope: 'module',
          moduleName,
          file: filePath,
          relPath,
          line: routine.line,
          endLine: routine.endLine,
          signature: routine.signature,
          params: routine.params,
          returnType: routine.returnType,
          accessor: routine.accessor,
        });

        for (const param of routine.params) {
          symbols.push({
            name: param.name,
            kind: 'Parameter',
            visibility: 'Private',
            scope: 'parameter',
            moduleName,
            file: filePath,
            relPath,
            line: routine.line,
            endLine: routine.line,
            signature: `${routine.name} parameter ${param.name}`,
            params: [],
            returnType: param.type,
            containerName: routine.name,
            containerKind: routine.kind,
            containerLine: routine.line,
          });
        }

        index = logical.endLine;
        continue;
      }

      const currentRoutine = this.findRoutineAtLine(routines, lineNum);

      if (fileExtension === '.frm') {
        const controlMatch = statement.match(BEGIN_CONTROL_RE);
        if (controlMatch) {
          const controlType = controlMatch[1].split('.').pop() || controlMatch[1];
          symbols.push({
            name: controlMatch[2],
            kind: 'Field',
            visibility: 'Public',
            scope: 'member',
            moduleName,
            file: filePath,
            relPath,
            line: lineNum,
            endLine: logical.endLine,
            signature: buildSignature(statement),
            params: [],
            returnType: controlType,
            containerName: moduleName,
            containerKind: 'Form',
            containerLine: 1,
          });

          index = logical.endLine;
          continue;
        }
      }

      const implementsMatch = statement.match(IMPLEMENTS_RE);
      if (implementsMatch && !currentRoutine && !openTypeSymbol && !openEnumSymbol) {
        symbols.push({
          name: implementsMatch[1],
          kind: 'Implements',
          visibility: 'Private',
          scope: 'module',
          moduleName,
          file: filePath,
          relPath,
          line: lineNum,
          endLine: logical.endLine,
          signature: buildSignature(statement),
          params: [],
          returnType: '',
        });

        index = logical.endLine;
        continue;
      }

      const declareMatch = statement.match(DECLARE_RE);
      if (declareMatch) {
        const visibility = (declareMatch[1] || 'Public') as 'Public' | 'Private';
        const returnType = declareMatch[2].toLowerCase() === 'function' ? parseReturnType(statement) : '';

        symbols.push({
          name: declareMatch[3],
          kind: 'Declare',
          visibility,
          scope: 'module',
          moduleName,
          file: filePath,
          relPath,
          line: lineNum,
          endLine: logical.endLine,
          signature: buildSignature(statement),
          params: parseParameters(statement.substring(statement.indexOf('('))),
          returnType,
        });

        index = logical.endLine;
        continue;
      }

      const typeMatch = statement.match(TYPE_RE);
      if (typeMatch) {
        openTypeSymbol = {
          name: typeMatch[2],
          kind: 'Type',
          visibility: (typeMatch[1] || 'Private') as 'Public' | 'Private',
          scope: 'module',
          moduleName,
          file: filePath,
          relPath,
          line: lineNum,
          endLine: lineNum,
          signature: buildSignature(statement),
          params: [],
          returnType: '',
        };
        symbols.push(openTypeSymbol);
        index = logical.endLine;
        continue;
      }

      const enumMatch = statement.match(ENUM_RE);
      if (enumMatch) {
        openEnumSymbol = {
          name: enumMatch[2],
          kind: 'Enum',
          visibility: (enumMatch[1] || 'Public') as 'Public' | 'Private',
          scope: 'module',
          moduleName,
          file: filePath,
          relPath,
          line: lineNum,
          endLine: lineNum,
          signature: buildSignature(statement),
          params: [],
          returnType: '',
        };
        symbols.push(openEnumSymbol);
        index = logical.endLine;
        continue;
      }

      const endBlockMatch = statement.match(END_BLOCK_RE);
      if (endBlockMatch) {
        const endKind = endBlockMatch[1].toLowerCase();
        if (endKind === 'type' && openTypeSymbol) {
          openTypeSymbol.endLine = logical.endLine;
          openTypeSymbol = null;
        } else if (endKind === 'enum' && openEnumSymbol) {
          openEnumSymbol.endLine = logical.endLine;
          openEnumSymbol = null;
        }

        index = logical.endLine;
        continue;
      }

      const eventMatch = statement.match(EVENT_RE);
      if (eventMatch && !currentRoutine) {
        symbols.push({
          name: eventMatch[2],
          kind: 'Event',
          visibility: (eventMatch[1] || 'Public') as 'Public' | 'Private',
          scope: 'module',
          moduleName,
          file: filePath,
          relPath,
          line: lineNum,
          endLine: logical.endLine,
          signature: buildSignature(statement),
          params: parseParameters(statement.substring(statement.indexOf('('))),
          returnType: '',
        });

        index = logical.endLine;
        continue;
      }

      const constMatch = statement.match(CONST_RE);
      if (constMatch && !openTypeSymbol && !openEnumSymbol) {
        const visibility = currentRoutine
          ? 'Private'
          : ((constMatch[1] || 'Private').toLowerCase() === 'public' || (constMatch[1] || '').toLowerCase() === 'global'
            ? 'Public'
            : 'Private');

        symbols.push({
          name: constMatch[2],
          kind: 'Const',
          visibility: visibility as 'Public' | 'Private',
          scope: currentRoutine ? 'local' : 'module',
          moduleName,
          file: filePath,
          relPath,
          line: lineNum,
          endLine: logical.endLine,
          signature: buildSignature(statement),
          params: [],
          returnType: '',
          containerName: currentRoutine?.name,
          containerKind: currentRoutine?.kind,
          containerLine: currentRoutine?.line,
        });

        index = logical.endLine;
        continue;
      }

      if (openTypeSymbol) {
        const field = parseTypeFieldDeclaration(statement);
        if (field) {
          symbols.push({
            name: field.name,
            kind: 'Field',
            visibility: openTypeSymbol.visibility,
            scope: 'member',
            moduleName,
            file: filePath,
            relPath,
            line: lineNum,
            endLine: logical.endLine,
            signature: buildSignature(statement),
            params: [],
            returnType: field.type,
            containerName: openTypeSymbol.name,
            containerKind: 'Type',
            containerLine: openTypeSymbol.line,
          });
        }

        index = logical.endLine;
        continue;
      }

      if (VARIABLE_RE.test(statement) && !openTypeSymbol && !openEnumSymbol) {
        const declarations = parseVariableDeclarations(statement);
        for (const declaration of declarations) {
          const visibility = currentRoutine
            ? 'Private'
            : declaration.visibilityKeyword === 'Public' || declaration.visibilityKeyword === 'Global'
              ? 'Public'
              : 'Private';

          symbols.push({
            name: declaration.name,
            kind: 'Variable',
            visibility,
            scope: currentRoutine ? 'local' : 'module',
            moduleName,
            file: filePath,
            relPath,
            line: lineNum,
            endLine: logical.endLine,
            signature: buildSignature(statement),
            params: [],
            returnType: declaration.type,
            containerName: currentRoutine?.name,
            containerKind: currentRoutine?.kind,
            containerLine: currentRoutine?.line,
          });
        }

        index = logical.endLine;
        continue;
      }

      index = logical.endLine;
    }

    this.index.files.add(normPath);
    this.index.byFile.set(normPath, symbols);

    for (const symbol of symbols) {
      const nameKey = symbol.name.toLowerCase();
      const existing = this.index.byName.get(nameKey) || [];
      existing.push(symbol);
      this.index.byName.set(nameKey, existing);
    }

    return symbols;
  }

  private detectModuleName(filePath: string, lines: string[]): string {
    let moduleName = path.basename(filePath, path.extname(filePath));

    for (const line of lines) {
      const match = line.match(VB_NAME_RE);
      if (match) {
        moduleName = match[1];
        break;
      }
    }

    return moduleName;
  }

  private collectRoutines(lines: string[]): RoutineContext[] {
    const routines: RoutineContext[] = [];
    const stack: Array<Omit<RoutineContext, 'endLine'>> = [];

    for (let index = 0; index < lines.length; ) {
      const logical = readLogicalLine(lines, index);
      const statement = logical.text.trimStart();

      if (!statement || isCommentLine(statement) || ATTRIBUTE_RE.test(statement)) {
        index = logical.endLine;
        continue;
      }

      const symbolMatch = statement.match(SYMBOL_RE);
      if (symbolMatch && !statement.match(DECLARE_RE)) {
        const kind = normalizeRoutineKind(symbolMatch[3]);
        const accessor = normalizeAccessor(symbolMatch[4]);
        const params = parseParameters(symbolMatch[6]);
        const returnType = kind === 'Function' || (kind === 'Property' && accessor === 'Get')
          ? parseReturnType(symbolMatch[6])
          : '';

        stack.push({
          name: symbolMatch[5],
          kind,
          visibility: (symbolMatch[1] || 'Public') as 'Public' | 'Private' | 'Friend',
          accessor,
          line: logical.startLine,
          signature: buildSignature(statement),
          params,
          returnType,
        });

        index = logical.endLine;
        continue;
      }

      const endMatch = statement.match(END_BLOCK_RE);
      if (endMatch) {
        const endKind = endMatch[1].toLowerCase();
        if (endKind === 'sub' || endKind === 'function' || endKind === 'property') {
          for (let cursor = stack.length - 1; cursor >= 0; cursor--) {
            if (stack[cursor].kind.toLowerCase() === endKind) {
              const routine = stack.splice(cursor, 1)[0];
              routines.push({
                ...routine,
                endLine: logical.endLine,
              });
              break;
            }
          }
        }
      }

      index = logical.endLine;
    }

    return routines.sort((left, right) => left.line - right.line);
  }

  private findRoutineAtLine(routines: RoutineContext[], line: number): RoutineContext | undefined {
    return routines.find((routine) => routine.line < line && routine.endLine >= line);
  }
}

function normalizeRoutineKind(value: string): 'Sub' | 'Function' | 'Property' {
  const lower = value.toLowerCase();
  if (lower === 'function') return 'Function';
  if (lower === 'property') return 'Property';
  return 'Sub';
}

function normalizeAccessor(value: string | undefined): 'Get' | 'Let' | 'Set' | undefined {
  if (!value) return undefined;
  const lower = value.trim().toLowerCase();
  if (lower === 'get') return 'Get';
  if (lower === 'let') return 'Let';
  if (lower === 'set') return 'Set';
  return undefined;
}
