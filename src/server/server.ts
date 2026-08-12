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
import { LspTelemetryContext, createLspTelemetryContext, documentExtFromUri, recordLspTelemetry, summarizeDiagnostics, summarizeLspResult } from './telemetry';
import { DocumentSnapshotStore } from './documentStore';
import { isSupportedVB6Source } from '../shared/components';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const snapshots = new DocumentSnapshotStore();
const SERVER_VERSION = '3.4.0';

let indexer: VB6Indexer | null = null;
let watcher: VB6Watcher | null = null;
let workspaceConfig: VB6WorkspaceConfig;
let telemetry: LspTelemetryContext | null = null;
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
  telemetry = createLspTelemetryContext(workspaceConfig.rootDir, SERVER_VERSION);

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
  telemetry = createLspTelemetryContext(workspaceConfig.rootDir, SERVER_VERSION);

  await rebuildIndex('configuration');
});

documents.onDidOpen((event) => {
  snapshots.setDocument(event.document);
  if (indexer) {
    const filePath = uriToPath(event.document.uri);
    if (isSupportedVB6Source(filePath)) {
      indexer.upsertFile(filePath, event.document.getText());
    }
  }
  pushDiagnostics(event.document.uri);
});

documents.onDidChangeContent((event) => {
  snapshots.setDocument(event.document);
  if (!indexer) return;

  const filePath = uriToPath(event.document.uri);
  if (isSupportedVB6Source(filePath)) {
    indexer.upsertFile(filePath, event.document.getText());
    pushDiagnostics(event.document.uri);
  }
});

documents.onDidSave((event) => {
  snapshots.setDocument(event.document);
  if (!indexer) return;

  const filePath = uriToPath(event.document.uri);
  if (isSupportedVB6Source(filePath)) {
    indexer.upsertFile(filePath, event.document.getText());
    pushDiagnostics(event.document.uri);
  }
});

documents.onDidClose((event) => {
  const filePath = uriToPath(event.document.uri);
  snapshots.removeUri(event.document.uri);
  if (isSupportedVB6Source(filePath) && indexer) {
    indexer.rebuildFile(filePath);
  }
});

function pushDiagnostics(uri: string): void {
  if (!indexer) return;

  const started = Date.now();
  try {
    const filePath = uriToPath(uri);
    const diagnostics = computeDiagnostics(filePath, indexer.getIndex(), workspaceConfig, snapshots);
    connection.sendDiagnostics({ uri, diagnostics });
    const summary = summarizeDiagnostics(diagnostics);
    recordProviderTelemetry('diagnostics', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(uri),
      diagnostics_count: diagnostics.length,
    });
  } catch (error) {
    connection.console.error(`Diagnostics error: ${error}`);
    recordProviderTelemetry('diagnostics', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(uri),
    });
  }
}

function recordProviderTelemetry(
  provider: string,
  started: number,
  resultCount: number | null,
  resultCountState: 'measured' | 'na' | 'unknown',
  error: unknown,
  inputSummary: { document_ext?: string; position_present?: boolean; query_length?: number; diagnostics_count?: number } = {},
): void {
  if (!telemetry) return;
  recordLspTelemetry(telemetry, {
    ts: new Date().toISOString(),
    provider,
    duration_ms: Date.now() - started,
    result_count: resultCount,
    result_count_state: resultCountState,
    error: error ? error instanceof Error ? error.message : String(error) : null,
    input_summary: inputSummary,
  });
}

connection.onDefinition((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleDefinition(params, documents, indexer.getIndex()) : null;
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('definition', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return result;
  } catch (error) {
    connection.console.error(`Definition error: ${error}`);
    recordProviderTelemetry('definition', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return null;
  }
});

connection.onReferences((params, token) => {
  const started = Date.now();
  try {
    const result = indexer ? handleReferences(params, documents, indexer.getIndex(), snapshots, token) : null;
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('references', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return result;
  } catch (error) {
    connection.console.error(`References error: ${error}`);
    recordProviderTelemetry('references', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return null;
  }
});

connection.onHover((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleHover(params, documents, indexer.getIndex()) : null;
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('hover', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return result;
  } catch (error) {
    connection.console.error(`Hover error: ${error}`);
    recordProviderTelemetry('hover', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return null;
  }
});

connection.onDocumentSymbol((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleDocumentSymbol(params, indexer.getIndex()) : [];
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('documentSymbol', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
    });
    return result;
  } catch (error) {
    connection.console.error(`DocumentSymbol error: ${error}`);
    recordProviderTelemetry('documentSymbol', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
    });
    return [];
  }
});

connection.onWorkspaceSymbol((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleWorkspaceSymbol(params, indexer.getIndex()) : [];
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('workspaceSymbol', started, summary.resultCount, summary.resultCountState, null, {
      query_length: params.query.length,
    });
    return result;
  } catch (error) {
    connection.console.error(`WorkspaceSymbol error: ${error}`);
    recordProviderTelemetry('workspaceSymbol', started, null, 'unknown', error, {
      query_length: params.query.length,
    });
    return [];
  }
});

connection.onCompletion((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleCompletion(params, documents, indexer.getIndex()) : [];
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('completion', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return result;
  } catch (error) {
    connection.console.error(`Completion error: ${error}`);
    recordProviderTelemetry('completion', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return [];
  }
});

connection.onSignatureHelp((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleSignatureHelp(params, documents, indexer.getIndex()) : null;
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('signatureHelp', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return result;
  } catch (error) {
    connection.console.error(`SignatureHelp error: ${error}`);
    recordProviderTelemetry('signatureHelp', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return null;
  }
});

connection.onPrepareRename((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handlePrepareRename(params, documents, indexer.getIndex()) : null;
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('prepareRename', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return result;
  } catch (error) {
    connection.console.error(`PrepareRename error: ${error}`);
    recordProviderTelemetry('prepareRename', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return null;
  }
});

connection.onRenameRequest((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleRename(params, documents, indexer.getIndex(), snapshots) : null;
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('rename', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return result;
  } catch (error) {
    connection.console.error(`Rename error: ${error}`);
    recordProviderTelemetry('rename', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      position_present: true,
    });
    return null;
  }
});

connection.onFoldingRanges((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleFoldingRanges(params, indexer.getIndex()) : [];
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('foldingRange', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
    });
    return result;
  } catch (error) {
    connection.console.error(`FoldingRange error: ${error}`);
    recordProviderTelemetry('foldingRange', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
    });
    return [];
  }
});

connection.onCodeAction((params) => {
  const started = Date.now();
  try {
    const result = handleCodeActions(params, snapshots);
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('codeAction', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      diagnostics_count: params.context.diagnostics.length,
    });
    return result;
  } catch (error) {
    connection.console.error(`CodeAction error: ${error}`);
    recordProviderTelemetry('codeAction', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
      diagnostics_count: params.context.diagnostics.length,
    });
    return [];
  }
});

connection.languages.semanticTokens.on((params) => {
  const started = Date.now();
  try {
    const result = indexer ? handleSemanticTokens(params, indexer.getIndex(), snapshots) : { data: [] };
    const summary = summarizeLspResult(result);
    recordProviderTelemetry('semanticTokens', started, summary.resultCount, summary.resultCountState, null, {
      document_ext: documentExtFromUri(params.textDocument.uri),
    });
    return result;
  } catch (error) {
    connection.console.error(`SemanticTokens error: ${error}`);
    recordProviderTelemetry('semanticTokens', started, null, 'unknown', error, {
      document_ext: documentExtFromUri(params.textDocument.uri),
    });
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
    indexer = new VB6Indexer(workspaceConfig.rootDir, workspaceConfig.sourceDirs, snapshots);
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
