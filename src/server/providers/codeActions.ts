import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Diagnostic,
  Range,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver';
import * as fs from 'fs';
import { uriToPath } from '../utils';

export function handleCodeActions(params: CodeActionParams): CodeAction[] {
  const actions: CodeAction[] = [];
  const filePath = uriToPath(params.textDocument.uri);
  const fileText = readFile(filePath);

  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source !== 'vb6-lsp') continue;

    if (diagnostic.message === 'Missing Option Explicit') {
      actions.push(createAddOptionExplicitAction(params.textDocument.uri, fileText, diagnostic));
      continue;
    }

    const missingEndMatch = diagnostic.message.match(/^Missing End (\w+) for '([^']+)'$/);
    if (missingEndMatch) {
      actions.push(createMissingEndAction(
        params.textDocument.uri,
        fileText,
        diagnostic,
        missingEndMatch[1],
      ));
    }
  }

  return actions;
}

function createAddOptionExplicitAction(uri: string, text: string, diagnostic: Diagnostic): CodeAction {
  const lines = text.split(/\r?\n/);
  let insertLine = 0;

  while (insertLine < lines.length && /^Attribute\s+/i.test(lines[insertLine])) {
    insertLine++;
  }

  const edit: WorkspaceEdit = {
    changes: {
      [uri]: [
        TextEdit.insert(Position(insertLine, 0), 'Option Explicit\r\n'),
      ],
    },
  };

  return {
    title: 'Add Option Explicit',
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit,
  };
}

function createMissingEndAction(uri: string, text: string, diagnostic: Diagnostic, blockKind: string): CodeAction {
  const lines = text.split(/\r?\n/);
  const insertLine = lines.length;
  const edit: WorkspaceEdit = {
    changes: {
      [uri]: [
        TextEdit.insert(Position(insertLine, 0), `${insertLine > 0 ? '\r\n' : ''}End ${blockKind}\r\n`),
      ],
    },
  };

  return {
    title: `Add End ${blockKind}`,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit,
  };
}

function Position(line: number, character: number) {
  return { line, character };
}

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'latin1');
  } catch {
    return '';
  }
}
