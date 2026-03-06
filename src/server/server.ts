import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  TextDocuments,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { VB6Indexer } from './indexer/indexer';
import { VB6Watcher } from './indexer/watcher';
import { handleDefinition } from './providers/definition';
import { handleReferences } from './providers/references';
import { handleHover } from './providers/hover';
import { handleDocumentSymbol } from './providers/documentSymbol';
import { handleWorkspaceSymbol } from './providers/workspaceSymbol';
import { handleCompletion } from './providers/completion';
import { handleSignatureHelp } from './providers/signatureHelp';
import { computeDiagnostics } from './providers/diagnostics';
import { handlePrepareRename, handleRename } from './providers/rename';
import { handleFoldingRanges } from './providers/foldingRanges';
import { handleCodeActions } from './providers/codeActions';
import { handleSemanticTokens, VB6_SEMANTIC_TOKEN_LEGEND } from './providers/semanticTokens';
import { uriToPath } from './utils';
import { resolveWorkspaceConfig, VB6ServerSettings, VB6WorkspaceConfig } from './config';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let indexer: VB6Indexer | null = null;
let watcher: VB6Watcher | null = null;
let workspaceConfig: VB6WorkspaceConfig;
let currentSettings: VB6ServerSettings = {};
let lastInitializeParams: InitializeParams | null = null;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  lastInitializeParams = params;
  currentSettings = extractSettings(params.initializationOptions);
  workspaceConfig = resolveWorkspaceConfig({
    rootUri: params.rootUri,
    workspaceFolders: params.workspaceFolders,
    settings: currentSettings,
  });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      completionProvider: {
        triggerCharacters: ['.', '_'],
        resolveProvider: false,
      },
      signatureHelpProvider: {
        triggerCharacters: ['(', ','],
      },
      renameProvider: {
        prepareProvider: true,
      },
      foldingRangeProvider: true,
      codeActionProvider: true,
      semanticTokensProvider: {
        legend: VB6_SEMANTIC_TOKEN_LEGEND,
        full: true,
      },
    },
  };
});

connection.onInitialized(async () => {
  await rebuildIndex('initialized');
});

connection.onDidChangeConfiguration(async (change) => {
  const settings = extractSettings(change.settings);
  currentSettings = settings;
  if (!lastInitializeParams) return;

  workspaceConfig = resolveWorkspaceConfig({
    rootUri: lastInitializeParams.rootUri,
    workspaceFolders: lastInitializeParams.workspaceFolders,
    settings: currentSettings,
  });

  await rebuildIndex('configuration');
});

documents.onDidOpen((event) => {
  pushDiagnostics(event.document.uri);
});

documents.onDidChangeContent((event) => {
  if (!indexer) return;

  const filePath = uriToPath(event.document.uri);
  if (/\.(bas|cls|frm)$/i.test(filePath)) {
    indexer.rebuildFile(filePath);
    pushDiagnostics(event.document.uri);
  }
});

documents.onDidSave((event) => {
  if (!indexer) return;

  const filePath = uriToPath(event.document.uri);
  if (/\.(bas|cls|frm)$/i.test(filePath)) {
    indexer.rebuildFile(filePath);
    pushDiagnostics(event.document.uri);
  }
});

function pushDiagnostics(uri: string): void {
  if (!indexer) return;

  try {
    const filePath = uriToPath(uri);
    const diagnostics = computeDiagnostics(filePath, indexer.getIndex());
    connection.sendDiagnostics({ uri, diagnostics });
  } catch (error) {
    connection.console.error(`Diagnostics error: ${error}`);
  }
}

connection.onDefinition((params) => {
  try {
    return indexer ? handleDefinition(params, documents, indexer.getIndex()) : null;
  } catch (error) {
    connection.console.error(`Definition error: ${error}`);
    return null;
  }
});

connection.onReferences((params) => {
  try {
    return indexer ? handleReferences(params, documents, indexer.getIndex()) : null;
  } catch (error) {
    connection.console.error(`References error: ${error}`);
    return null;
  }
});

connection.onHover((params) => {
  try {
    return indexer ? handleHover(params, documents, indexer.getIndex()) : null;
  } catch (error) {
    connection.console.error(`Hover error: ${error}`);
    return null;
  }
});

connection.onDocumentSymbol((params) => {
  try {
    return indexer ? handleDocumentSymbol(params, indexer.getIndex()) : [];
  } catch (error) {
    connection.console.error(`DocumentSymbol error: ${error}`);
    return [];
  }
});

connection.onWorkspaceSymbol((params) => {
  try {
    return indexer ? handleWorkspaceSymbol(params, indexer.getIndex()) : [];
  } catch (error) {
    connection.console.error(`WorkspaceSymbol error: ${error}`);
    return [];
  }
});

connection.onCompletion((params) => {
  try {
    return indexer ? handleCompletion(params, documents, indexer.getIndex()) : [];
  } catch (error) {
    connection.console.error(`Completion error: ${error}`);
    return [];
  }
});

connection.onSignatureHelp((params) => {
  try {
    return indexer ? handleSignatureHelp(params, documents, indexer.getIndex()) : null;
  } catch (error) {
    connection.console.error(`SignatureHelp error: ${error}`);
    return null;
  }
});

connection.onPrepareRename((params) => {
  try {
    return indexer ? handlePrepareRename(params, documents, indexer.getIndex()) : null;
  } catch (error) {
    connection.console.error(`PrepareRename error: ${error}`);
    return null;
  }
});

connection.onRenameRequest((params) => {
  try {
    return indexer ? handleRename(params, documents, indexer.getIndex()) : null;
  } catch (error) {
    connection.console.error(`Rename error: ${error}`);
    return null;
  }
});

connection.onFoldingRanges((params) => {
  try {
    return indexer ? handleFoldingRanges(params, indexer.getIndex()) : [];
  } catch (error) {
    connection.console.error(`FoldingRange error: ${error}`);
    return [];
  }
});

connection.onCodeAction((params) => {
  try {
    return handleCodeActions(params);
  } catch (error) {
    connection.console.error(`CodeAction error: ${error}`);
    return [];
  }
});

connection.languages.semanticTokens.on((params) => {
  try {
    return indexer ? handleSemanticTokens(params, indexer.getIndex()) : { data: [] };
  } catch (error) {
    connection.console.error(`SemanticTokens error: ${error}`);
    return { data: [] };
  }
});

connection.onShutdown(async () => {
  if (watcher) {
    await watcher.stop();
    watcher = null;
  }
});

documents.listen(connection);
connection.listen();

async function rebuildIndex(reason: 'initialized' | 'configuration'): Promise<void> {
  if (watcher) {
    await watcher.stop();
    watcher = null;
  }

  connection.sendNotification('vb6/indexing', {
    status: 'started',
    reason,
    rootDir: workspaceConfig.rootDir,
    sourceDirCount: workspaceConfig.sourceDirs.length,
    projectFileCount: workspaceConfig.projectFiles.length,
    externalReferenceCount: workspaceConfig.externalReferences.length,
  });

  try {
    indexer = new VB6Indexer(workspaceConfig.rootDir, workspaceConfig.sourceDirs);
    const symbolCount = indexer.buildFullIndex();
    const fileCount = indexer.getIndex().files.size;

    connection.sendNotification('vb6/indexing', {
      status: 'done',
      symbolCount,
      fileCount,
      rootDir: workspaceConfig.rootDir,
      sourceDirs: workspaceConfig.sourceDirs,
      projectFiles: workspaceConfig.projectFiles,
      projectCount: workspaceConfig.projects.length,
      externalReferenceCount: workspaceConfig.externalReferences.length,
    });

    connection.console.log(
      `VB6 LSP: Indexed ${symbolCount} symbols from ${fileCount} files (${workspaceConfig.sourceDirs.length} source dirs)`,
    );

    watcher = new VB6Watcher(indexer, () => {
      for (const doc of documents.all()) {
        pushDiagnostics(doc.uri);
      }
    });
    watcher.start(workspaceConfig.sourceDirs);

    for (const doc of documents.all()) {
      pushDiagnostics(doc.uri);
    }
  } catch (error) {
    connection.console.error(`VB6 LSP: Index failed — ${error}`);
    connection.sendNotification('vb6/indexing', {
      status: 'error',
      message: String(error),
    });
  }
}

function extractSettings(value: unknown): VB6ServerSettings {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const vb6 = candidate.vb6 && typeof candidate.vb6 === 'object'
    ? candidate.vb6 as Record<string, unknown>
    : candidate;

  return {
    workspaceRoot: typeof vb6.workspaceRoot === 'string' ? vb6.workspaceRoot : undefined,
    projectFiles: Array.isArray(vb6.projectFiles)
      ? vb6.projectFiles.filter((item): item is string => typeof item === 'string')
      : undefined,
    sourcePaths: Array.isArray(vb6.sourcePaths)
      ? vb6.sourcePaths.filter((item): item is string => typeof item === 'string')
      : undefined,
    preferProjectFiles: typeof vb6.preferProjectFiles === 'boolean' ? vb6.preferProjectFiles : undefined,
  };
}
