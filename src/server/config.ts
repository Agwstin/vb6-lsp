import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';

export interface VB6ServerSettings {
  workspaceRoot?: string;
  projectFiles?: string[];
  sourcePaths?: string[];
  preferProjectFiles?: boolean;
}

export interface VB6ProjectComponent {
  kind: 'Module' | 'Class' | 'Form' | 'UserControl' | 'Designer';
  name: string;
  path: string;
}

export interface VB6ProjectReference {
  kind: 'Reference' | 'Object';
  raw: string;
  libraryPath?: string;
  description?: string;
  guid?: string;
  version?: string;
  majorVersion?: string;
  minorVersion?: string;
  libraryName?: string;
  exists?: boolean;
}

export interface VB6ProjectMetadata {
  file: string;
  name?: string;
  type?: string;
  components: VB6ProjectComponent[];
  references: VB6ProjectReference[];
  objects: VB6ProjectReference[];
}

export interface VB6WorkspaceConfig {
  rootDir: string;
  projectFiles: string[];
  sourceDirs: string[];
  projects: VB6ProjectMetadata[];
  externalReferences: VB6ProjectReference[];
  objectReferences: VB6ProjectReference[];
}

export function findProjectsForFile(config: VB6WorkspaceConfig, filePath: string): VB6ProjectMetadata[] {
  const resolved = path.resolve(filePath).toLowerCase();
  return config.projects.filter((project) =>
    project.components.some((component) => path.resolve(component.path).toLowerCase() === resolved),
  );
}

const COMPONENT_PREFIXES = new Map<string, VB6ProjectComponent['kind']>([
  ['Module=', 'Module'],
  ['Class=', 'Class'],
  ['Form=', 'Form'],
  ['UserControl=', 'UserControl'],
  ['Designer=', 'Designer'],
]);

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

  const projects = discoveredProjectFiles.map(parseProjectFile).filter((project): project is VB6ProjectMetadata => Boolean(project));
  const sourceDirsFromProjects = preferProjectFiles
    ? dedupePaths(projects.flatMap((project) => project.components.map((component) => path.dirname(component.path))))
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
    projects,
    externalReferences: dedupeReferences(projects.flatMap((project) => project.references)),
    objectReferences: dedupeReferences(projects.flatMap((project) => project.objects)),
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

function parseProjectFile(projectFile: string): VB6ProjectMetadata | null {
  let lines: string[];
  try {
    lines = fs.readFileSync(projectFile, 'latin1').split(/\r?\n/);
  } catch {
    return null;
  }

  const projectDir = path.dirname(projectFile);
  const components: VB6ProjectComponent[] = [];
  const references: VB6ProjectReference[] = [];
  const objects: VB6ProjectReference[] = [];
  let name;
  let type;

  for (const line of lines) {
    if (line.startsWith('Name=')) {
      name = stripProjectValue(line.substring('Name='.length));
      continue;
    }

    if (line.startsWith('Type=')) {
      type = stripProjectValue(line.substring('Type='.length));
      continue;
    }

    if (line.startsWith('Reference=')) {
      references.push(parseReferenceLine('Reference', line.substring('Reference='.length).trim()));
      continue;
    }

    if (line.startsWith('Object=')) {
      objects.push(parseReferenceLine('Object', line.substring('Object='.length).trim()));
      continue;
    }

    const componentEntry = [...COMPONENT_PREFIXES.entries()].find(([prefix]) => line.startsWith(prefix));
    if (!componentEntry) continue;

    const [prefix, kind] = componentEntry;
    const rawValue = line.substring(prefix.length).trim();
    const componentPath = extractProjectFilePath(rawValue);
    if (!componentPath) continue;

    const componentName = extractComponentName(rawValue, componentPath);
    const fullPath = path.resolve(projectDir, componentPath);
    if (!fs.existsSync(fullPath)) continue;

    components.push({
      kind,
      name: componentName,
      path: fullPath,
    });
  }

  return {
    file: projectFile,
    name,
    type,
    components,
    references,
    objects,
  };
}

function parseReferenceLine(kind: 'Reference' | 'Object', raw: string): VB6ProjectReference {
  const guidMatch = raw.match(/\{[^}]+\}/);

  let libraryPath;
  let description;
  let version;
  let majorVersion;
  let minorVersion;

  if (kind === 'Object') {
    const semicolonIndex = raw.lastIndexOf(';');
    if (semicolonIndex >= 0) {
      description = stripProjectValue(raw.substring(semicolonIndex + 1));
    }
  } else {
    const parts = raw.split('#');
    majorVersion = parts.length >= 2 ? stripProjectValue(parts[1]) : undefined;
    minorVersion = parts.length >= 3 ? stripProjectValue(parts[2]) : undefined;
    libraryPath = parts.length >= 4 ? stripProjectValue(parts[parts.length - 2]) : undefined;
    description = parts.length >= 1 ? stripProjectValue(parts[parts.length - 1]) : undefined;
    if (majorVersion || minorVersion) {
      version = `${majorVersion || '0'}.${minorVersion || '0'}`;
    }
  }

  return {
    kind,
    raw,
    libraryPath,
    description,
    guid: guidMatch ? guidMatch[0] : undefined,
    version,
    majorVersion,
    minorVersion,
    libraryName: libraryPath ? path.basename(libraryPath) : description,
    exists: libraryPath ? fs.existsSync(libraryPath) : undefined,
  };
}

function extractProjectFilePath(value: string): string | null {
  const semicolonIndex = value.lastIndexOf(';');
  const candidate = semicolonIndex >= 0 ? value.substring(semicolonIndex + 1).trim() : value.trim();
  return candidate || null;
}

function extractComponentName(rawValue: string, componentPath: string): string {
  const semicolonIndex = rawValue.lastIndexOf(';');
  if (semicolonIndex >= 0) {
    const left = rawValue.substring(0, semicolonIndex).trim();
    if (left) return stripProjectValue(left);
  }
  return path.basename(componentPath, path.extname(componentPath));
}

function stripProjectValue(value: string): string {
  return value.replace(/^"|"$/g, '').trim();
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

function dedupeReferences(values: VB6ProjectReference[]): VB6ProjectReference[] {
  const seen = new Set<string>();
  const results: VB6ProjectReference[] = [];

  for (const value of values) {
    const key = `${value.kind}:${value.guid ?? ''}:${value.libraryPath ?? ''}:${value.description ?? ''}:${value.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(value);
  }

  return results;
}
