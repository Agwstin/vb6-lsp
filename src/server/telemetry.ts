import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'node:crypto';
import { Diagnostic } from 'vscode-languageserver';

export interface LspTelemetryContext {
  enabled: boolean;
  outputDir: string;
  workspaceId: string;
  sessionId: string;
  serverVersion: string;
}

export interface LspTelemetryEvent {
  schema_version: number;
  server_version: string;
  ts: string;
  session_id: string;
  workspace_id: string;
  provider: string;
  duration_ms: number;
  result_count: number | null;
  result_count_state: 'measured' | 'na' | 'unknown';
  error: string | null;
  input_summary: {
    document_ext?: string;
    position_present?: boolean;
    query_length?: number;
    diagnostics_count?: number;
  };
}

const LSP_TELEMETRY_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function createLspTelemetryContext(workspaceRoot: string, serverVersion: string): LspTelemetryContext {
  const enabled = /^(1|true|yes)$/i.test(process.env.VB6_LSP_TELEMETRY_ENABLED || '');
  const outputDir = process.env.VB6_LSP_TELEMETRY_DIR
    ? path.resolve(process.env.VB6_LSP_TELEMETRY_DIR)
    : path.resolve(process.cwd(), 'telemetry');

  return {
    enabled,
    outputDir,
    workspaceId: createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16),
    sessionId: randomUUID(),
    serverVersion,
  };
}

export function recordLspTelemetry(context: LspTelemetryContext, event: Omit<LspTelemetryEvent, 'schema_version' | 'server_version' | 'session_id' | 'workspace_id'>): void {
  if (!context.enabled) return;

  fs.mkdirSync(context.outputDir, { recursive: true });
  const filePath = path.join(context.outputDir, 'lsp-usage.jsonl');
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, JSON.stringify({
    schema_version: LSP_TELEMETRY_SCHEMA_VERSION,
    server_version: context.serverVersion,
    session_id: context.sessionId,
    workspace_id: context.workspaceId,
    ...event,
  }) + '\n', 'utf8');
}

export function summarizeLspResult(result: unknown): { resultCount: number | null; resultCountState: 'measured' | 'na' | 'unknown' } {
  if (result === null || typeof result === 'undefined') return { resultCount: 0, resultCountState: 'measured' };
  if (Array.isArray(result)) return { resultCount: result.length, resultCountState: 'measured' };
  if (typeof result === 'object' && result && Array.isArray((result as Record<string, unknown>).data)) {
    return { resultCount: ((result as Record<string, unknown>).data as unknown[]).length, resultCountState: 'measured' };
  }
  return { resultCount: null, resultCountState: 'na' };
}

export function summarizeDiagnostics(diagnostics: Diagnostic[]): { resultCount: number; resultCountState: 'measured' } {
  return {
    resultCount: diagnostics.length,
    resultCountState: 'measured',
  };
}

export function documentExtFromUri(uri: string): string | undefined {
  const clean = uri.split(/[?#]/)[0] || uri;
  const ext = path.extname(clean).toLowerCase();
  return ext || undefined;
}

function rotateIfNeeded(filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size < MAX_FILE_BYTES) return;
    fs.renameSync(filePath, `${filePath}.${Date.now()}`);
  } catch {
    // No file yet.
  }
}
