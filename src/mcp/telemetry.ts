import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';

export interface TelemetryContext {
  enabled: boolean;
  workspaceId: string;
  outputDir: string;
}

export interface TelemetryEvent {
  ts: string;
  workspace_id: string;
  tool_name: string;
  duration_ms: number;
  result_count: number | null;
  output_chars: number;
  index_cache_hit: boolean;
  derived_cache_hit: boolean;
  error: string | null;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function createTelemetryContext(workspaceRoot: string): TelemetryContext {
  const enabled = /^(1|true|yes)$/i.test(process.env.VB6_LSP_TELEMETRY_ENABLED || '');
  const outputDir = process.env.VB6_LSP_TELEMETRY_DIR
    ? path.resolve(process.env.VB6_LSP_TELEMETRY_DIR)
    : path.resolve(process.cwd(), 'telemetry');

  return {
    enabled,
    workspaceId: hashWorkspace(workspaceRoot),
    outputDir,
  };
}

export function recordTelemetry(context: TelemetryContext, event: TelemetryEvent): void {
  if (!context.enabled) return;

  fs.mkdirSync(context.outputDir, { recursive: true });
  const filePath = path.join(context.outputDir, 'mcp-usage.jsonl');
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
}

export function summarizeToolResult(payload: unknown): { resultCount: number | null; outputChars: number } {
  const outputChars = JSON.stringify(payload).length;
  return {
    resultCount: extractResultCount(payload),
    outputChars,
  };
}

function extractResultCount(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.count === 'number') return record.count;
  if (Array.isArray(record.matches)) return record.matches.length;
  if (Array.isArray(record.references)) return record.references.length;
  if (Array.isArray(record.results)) return record.results.length;
  if (Array.isArray(record.projects)) return record.projects.length;
  if (Array.isArray(record.entrypoints)) return record.entrypoints.length;
  if (Array.isArray(record.trace)) return record.trace.length;
  if (Array.isArray(record.mutations)) return record.mutations.length;
  if (record.analysis && typeof record.analysis === 'object') {
    const analysis = record.analysis as Record<string, unknown>;
    if (Array.isArray(analysis.references)) return analysis.references.length;
    if (typeof analysis.definitionCount === 'number') return analysis.definitionCount;
  }
  return null;
}

function rotateIfNeeded(filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size < MAX_FILE_BYTES) return;
    const rotated = `${filePath}.${Date.now()}`;
    fs.renameSync(filePath, rotated);
  } catch {
    // No file yet.
  }
}

function hashWorkspace(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
}
