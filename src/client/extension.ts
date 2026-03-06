import * as path from 'path';
import {
  workspace,
  window,
  ExtensionContext,
  StatusBarItem,
  StatusBarAlignment,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  DidChangeConfigurationNotification,
} from 'vscode-languageclient/node';

let client: LanguageClient;
let statusBarItem: StatusBarItem;

export function activate(context: ExtensionContext) {
  // Server module path
  const serverModule = context.asAbsolutePath(
    path.join('out', 'server', 'server.js')
  );

  // Server options: run and debug
  const serverOptions: ServerOptions = {
    run: {
      module: serverModule,
      transport: TransportKind.ipc,
    },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  // Client options
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'vb6' },
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/*.{bas,cls,frm}'),
      configurationSection: 'vb6',
    },
    initializationOptions: getInitializationOptions(),
  };

  // Create and start the client
  client = new LanguageClient(
    'vb6-lsp',
    'VB6 Language Server',
    serverOptions,
    clientOptions,
  );

  // Status bar for indexing progress
  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 0);
  statusBarItem.text = '$(sync~spin) VB6: Indexing...';
  context.subscriptions.push(statusBarItem);

  // Listen for custom indexing notifications
  client.onNotification('vb6/indexing', (params: { status: string; symbolCount?: number; fileCount?: number; message?: string }) => {
    if (params.status === 'started') {
      statusBarItem.text = '$(sync~spin) VB6: Indexing...';
      statusBarItem.show();
    } else if (params.status === 'done') {
      statusBarItem.text = `$(check) VB6: ${params.symbolCount} symbols (${params.fileCount} files)`;
      statusBarItem.show();
      // Hide after 5 seconds
      setTimeout(() => statusBarItem.hide(), 5000);
    } else if (params.status === 'error') {
      statusBarItem.text = `$(error) VB6: Index error`;
      statusBarItem.tooltip = params.message || 'Unknown error';
      statusBarItem.show();
    }
  });

  // Start the client (also starts the server)
  client.start();

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('vb6') || !client) return;
      void client.sendNotification(DidChangeConfigurationNotification.type, {
        settings: {
          vb6: workspace.getConfiguration('vb6'),
        },
      });
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) return undefined;
  return client.stop();
}

function getInitializationOptions() {
  const config = workspace.getConfiguration('vb6');

  return {
    vb6: {
      workspaceRoot: config.get<string>('workspaceRoot'),
      projectFiles: config.get<string[]>('projectFiles'),
      sourcePaths: config.get<string[]>('sourcePaths'),
      preferProjectFiles: config.get<boolean>('preferProjectFiles'),
    },
  };
}
