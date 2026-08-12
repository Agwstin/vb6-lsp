import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireBuiltOutput = process.argv.includes('--require-built') || process.env.VB6_REQUIRE_BUILT_OUTPUT === '1';
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ignoreLines = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (ignoreLines.includes('node_modules/**')) {
  throw new Error('The VSIX cannot exclude all node_modules: unbundled runtime dependencies would be missing.');
}

const requiredRuntimeFiles = [
  packageJson.main,
  'out/shared/components.js',
  'out/server/server.js',
  'out/mcp/shared/components.js',
  'out/mcp/mcp/server.js',
  'out/mcp/mcp/frx.js',
  'out/mcp/mcp/res.js',
  'language-configuration.json',
  'syntaxes/vb6.tmLanguage.json',
];
const packageOnlyFiles = [
  'telemetry/mcp-usage.jsonl',
  'vb6-mcp-launch.log',
  'run-vb6-mcp.cmd',
  'vb6-mcp-server.mjs',
  'tsconfig.mcp.json',
  'ROADMAP.md',
];
const missingFromManifest = requiredRuntimeFiles.filter(isIgnored);
if (missingFromManifest.length > 0) {
  throw new Error(`Required package files are explicitly ignored: ${missingFromManifest.join(', ')}`);
}
const leakedPackageFiles = packageOnlyFiles.filter((file) => !isIgnored(file));
if (leakedPackageFiles.length > 0) {
  throw new Error(`Non-runtime files would be included in the VSIX: ${leakedPackageFiles.join(', ')}`);
}
if (requireBuiltOutput) {
  const missingBuiltFiles = requiredRuntimeFiles
    .filter((file) => file.startsWith('out/'))
    .filter((file) => !fs.existsSync(path.join(root, file)));
  if (missingBuiltFiles.length > 0) {
    throw new Error(`Compiled package files are missing; run the approved build first: ${missingBuiltFiles.join(', ')}`);
  }
}

const iconPath = packageJson.icon ? path.join(root, packageJson.icon) : null;
if (!iconPath || !fs.existsSync(iconPath)) {
  throw new Error(`Marketplace icon is missing: ${packageJson.icon || '(package.json icon is unset)'}`);
}
if (isIgnored(packageJson.icon)) {
  throw new Error(`Marketplace icon is ignored by .vscodeignore: ${packageJson.icon}`);
}
const icon = fs.readFileSync(iconPath);
if (icon.length < 24 || icon.readUInt32BE(0) !== 0x89504e47 || icon.toString('ascii', 1, 4) !== 'PNG') {
  throw new Error(`Marketplace icon is not a PNG: ${packageJson.icon}`);
}
const iconWidth = icon.readUInt32BE(16);
const iconHeight = icon.readUInt32BE(20);
if (iconWidth < 128 || iconHeight < 128) {
  throw new Error(`Marketplace icon must be at least 128x128, got ${iconWidth}x${iconHeight}`);
}

const missingDependencies = Object.keys(packageJson.dependencies || {})
  .filter((dependency) => !fs.existsSync(path.join(root, 'node_modules', dependency)));
if (missingDependencies.length > 0) {
  throw new Error(`Runtime dependencies are not installed: ${missingDependencies.join(', ')}`);
}

process.stdout.write(JSON.stringify({
  main: packageJson.main,
  icon: { path: packageJson.icon, width: iconWidth, height: iconHeight },
  runtime_files: requiredRuntimeFiles,
  excluded_non_runtime_files: packageOnlyFiles,
  runtime_dependencies: Object.keys(packageJson.dependencies || {}).sort(),
  dependency_packaging: 'node_modules included except development-only type/compiler directories',
  built_output_verified: requireBuiltOutput,
}, null, 2) + '\n');

function isIgnored(filePath) {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return ignoreLines.some((pattern) => {
    const normalizedPattern = pattern.replaceAll('\\', '/').replace(/^\.\//, '');
    if (normalizedPattern === normalized) return true;
    if (normalizedPattern.endsWith('/**')) {
      return normalized.startsWith(normalizedPattern.slice(0, -2));
    }
    if (normalizedPattern === '*.log') return normalized.endsWith('.log');
    if (normalizedPattern === '**/*.ts') return normalized.endsWith('.ts');
    if (normalizedPattern === '**/*.map') return normalized.endsWith('.map');
    return false;
  });
}
