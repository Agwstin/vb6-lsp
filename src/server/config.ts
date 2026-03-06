import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';

export interface VB6ServerSettings {
  workspaceRoot?: string;
  projectFiles?: string[];
  sourcePaths?: string[];
  preferProjectFiles?: boolean;
}

export interface VB6WorkspaceConfig {
  rootDir: string;
  projectFiles: string[];
  sourceDirs: string[];
}

const SOURCE_FILE_PREFIXES = ['Module=', 'Class=', 'Form=', 'UserControl=', 'Designer='];
const IGNORED_DIRS = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  'out',
  'dist',
  '.vscode',
]);

export function resolveWorkspaceConfig(options: {
  rootUri?: string | null;
  workspaceFolders?: Array<{ uri: string }> | null;
  settings?: VB6ServerSettings;
}): VB6WorkspaceConfig {
  const initialRoot = resolveInitialRoot(options.rootUri, options.workspaceFolders);
  const rootDir = resolveRootDir(initialRoot, options.settings);

  const explicitProjectFiles = resolveConfiguredPaths(rootDir, options.settings?.projectFiles);
  const discoveredProjectFiles = explicitProjectFiles.length > 0 ? explicitProjectFiles : discoverProjectFiles(rootDir);
  const preferProjectFiles = options.settings?.preferProjectFiles !== false;

  const sourceDirsFromProjects = preferProjectFiles
    ? collectSourceDirsFromProjectFiles(discoveredProjectFiles)
    : [];
  const configuredSourceDirs = resolveConfiguredPaths(rootDir, options.settings?.sourcePaths)
    .filter((value) => fs.existsSync(value))
    .map((value) => path.resolve(value));

  const sourceDirs = dedupePaths([
    ...sourceDirsFromProjects,
    ...configuredSourceDirs,
    ...(sourceDirsFromProjects.length === 0 && configuredSourceDirs.length === 0 ? defaultSourceDirs(rootDir) : []),
  ]);

  return {
    rootDir,
    projectFiles: discoveredProjectFiles,
    sourceDirs,
  };
}

function resolveInitialRoot(
  rootUri?: string | null,
  workspaceFolders?: Array<{ uri: string }> | null,
): string {
  const folderUri = workspaceFolders?.[0]?.uri;
  const uri = rootUri || folderUri;
  if (!uri) return process.cwd();
  return URI.parse(uri).fsPath;
}

function resolveRootDir(initialRoot: string, settings?: VB6ServerSettings): string {
  if (!settings?.workspaceRoot) return path.resolve(initialRoot);
  return resolvePath(initialRoot, settings.workspaceRoot);
}

function resolveConfiguredPaths(rootDir: string, values?: string[]): string[] {
  if (!values || values.length === 0) return [];
  return dedupePaths(
    values
      .map((value) => resolvePath(rootDir, value))
      .filter((value) => fs.existsSync(value)),
  );
}

function resolvePath(rootDir: string, value: string): string {
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(rootDir, value);
}

function discoverProjectFiles(rootDir: string): string[] {
  const results: string[] = [];

  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        visit(fullPath);
        continue;
      }

      if (/\.vbp$/i.test(entry.name)) {
        results.push(path.resolve(fullPath));
      }
    }
  };

  visit(rootDir);
  return dedupePaths(results);
}

function collectSourceDirsFromProjectFiles(projectFiles: string[]): string[] {
  const directories: string[] = [];

  for (const projectFile of projectFiles) {
    let lines: string[];
    try {
      lines = fs.readFileSync(projectFile, 'latin1').split(/\r?\n/);
    } catch {
      continue;
    }

    const projectDir = path.dirname(projectFile);

    for (const line of lines) {
      const prefix = SOURCE_FILE_PREFIXES.find((candidate) => line.startsWith(candidate));
      if (!prefix) continue;

      const rawValue = line.substring(prefix.length).trim();
      const relativePath = extractProjectFilePath(rawValue);
      if (!relativePath) continue;

      const fullPath = path.resolve(projectDir, relativePath);
      if (!fs.existsSync(fullPath)) continue;
      directories.push(path.dirname(fullPath));
    }
  }

  return dedupePaths(directories);
}

function extractProjectFilePath(value: string): string | null {
  const semicolonIndex = value.lastIndexOf(';');
  const candidate = semicolonIndex >= 0 ? value.substring(semicolonIndex + 1).trim() : value.trim();
  return candidate || null;
}

function defaultSourceDirs(rootDir: string): string[] {
  const defaults = [
    path.join(rootDir, 'source'),
    path.join(rootDir, 'src'),
    path.join(rootDir, 'Client', 'SOURCE'),
    path.join(rootDir, 'Client', 'source'),
    path.join(rootDir, 'Server', 'source'),
    path.join(rootDir, 'Common'),
  ];

  return dedupePaths(defaults.filter((value) => fs.existsSync(value)));
}

function dedupePaths(values: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const normalized = path.resolve(value).toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    results.push(path.resolve(value));
  }

  return results;
}
