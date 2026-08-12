import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomUUID } from 'node:crypto';

export interface TelemetryContext {
  enabled: boolean;
  workspaceId: string;
  outputDir: string;
  sessionId: string;
  serverVersion: string;
}

export type TelemetryResultCountState = 'measured' | 'na' | 'unknown';
export type TelemetryCacheState = 'hit' | 'miss' | 'na';

export interface TelemetryInputSummary {
  arg_keys: string[];
  query_length?: number;
  scope_present?: boolean;
  name_length?: number;
  file_present?: boolean;
  file_length?: number;
  type_name_length?: number;
  filter_length?: number;
  kind_present?: boolean;
  include_body?: boolean;
  limit?: number;
  max_results?: number;
  offset?: number;
  compact?: boolean;
  max_body_lines?: number;
  max_depth?: number;
  functions_count?: number;
  queries_count?: number;
}

export interface TelemetryEvent {
  schema_version: number;
  server_version: string;
  ts: string;
  session_id: string;
  request_id: string | null;
  workspace_id: string;
  tool_name: string;
  duration_ms: number;
  result_count: number | null;
  result_count_state: TelemetryResultCountState;
  output_chars: number;
  index_cache: TelemetryCacheState;
  derived_cache: TelemetryCacheState;
  error: string | null;
  error_kind?: string | null;
  input_summary: TelemetryInputSummary;
  /** Raw text inputs, only populated on miss/error events when VB6_LSP_TELEMETRY_CAPTURE_INPUTS is on. */
  input_raw?: Record<string, string>;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const TELEMETRY_SCHEMA_VERSION = 4;
const RAW_INPUT_MAX_CHARS = 160;

/**
 * Opt-in: when VB6_LSP_TELEMETRY_CAPTURE_INPUTS is truthy, miss/error events also
 * record the raw text arguments (capped) so failure patterns can be diagnosed locally.
 */
export function shouldCaptureRawInputs(): boolean {
  return /^(1|true|yes)$/i.test(process.env.VB6_LSP_TELEMETRY_CAPTURE_INPUTS || '');
}

export function captureRawInputs(args: Record<string, unknown> = {}): Record<string, string> | undefined {
  if (!shouldCaptureRawInputs()) return undefined;
  const raw: Record<string, string> = {};
  for (const key of ['query', 'name', 'file', 'scope', 'filter', 'typeName', 'kind', 'symbol', 'routine', 'path', 'module', 'text', 'pattern']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) {
      raw[key] = value.slice(0, RAW_INPUT_MAX_CHARS);
    }
  }
  return Object.keys(raw).length > 0 ? raw : undefined;
}

export function createTelemetryContext(workspaceRoot: string, serverVersion: string): TelemetryContext {
  const enabled = /^(1|true|yes)$/i.test(process.env.VB6_LSP_TELEMETRY_ENABLED || '');
  const outputDir = process.env.VB6_LSP_TELEMETRY_DIR
    ? path.resolve(process.env.VB6_LSP_TELEMETRY_DIR)
    : path.resolve(process.cwd(), 'telemetry');

  return {
    enabled,
    workspaceId: hashWorkspace(workspaceRoot),
    outputDir,
    sessionId: randomUUID(),
    serverVersion,
  };
}

export function recordTelemetry(context: TelemetryContext, event: TelemetryEvent): void {
  if (!context.enabled) return;

  fs.mkdirSync(context.outputDir, { recursive: true });
  const filePath = path.join(context.outputDir, 'mcp-usage.jsonl');
  rotateIfNeeded(filePath);
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
}

export function summarizeToolResult(payload: unknown): {
  resultCount: number | null;
  resultCountState: TelemetryResultCountState;
  outputChars: number;
  error: string | null;
  errorKind: string | null;
} {
  const outputChars = JSON.stringify(payload).length;
  let innerData: unknown = payload;
  let toolError: string | null = null;
  let toolErrorKind: string | null = null;
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (record.isError === true) {
      toolError = extractToolError(record);
      toolErrorKind = extractToolErrorKind(record);
    }
    if (Array.isArray(record.content) && record.content.length > 0) {
      const first = record.content[0] as Record<string, unknown>;
      if (first.type === 'text' && typeof first.text === 'string') {
        try { innerData = JSON.parse(first.text); } catch { /* keep original */ }
      }
    }
  }
  if (toolError) {
    return {
      resultCount: null,
      resultCountState: 'na',
      outputChars,
      error: toolError,
      errorKind: toolErrorKind,
    };
  }
  const resultCount = extractResultCount(innerData);
  return {
    resultCount: resultCount.value,
    resultCountState: resultCount.state,
    outputChars,
    error: null,
    errorKind: null,
  };
}

export function summarizeToolArguments(args: Record<string, unknown> = {}): TelemetryInputSummary {
  const summary: TelemetryInputSummary = {
    arg_keys: Object.keys(args).sort(),
  };
  if (typeof args.query === 'string') summary.query_length = args.query.length;
  if (typeof args.scope === 'string') summary.scope_present = args.scope.length > 0;
  if (typeof args.name === 'string') summary.name_length = args.name.length;
  if (typeof args.file === 'string') {
    summary.file_present = true;
    summary.file_length = args.file.length;
  }
  if (typeof args.typeName === 'string') summary.type_name_length = args.typeName.length;
  if (typeof args.filter === 'string') summary.filter_length = args.filter.length;
  if (typeof args.kind === 'string') summary.kind_present = args.kind.length > 0;
  if (typeof args.includeBody === 'boolean') summary.include_body = args.includeBody;
  if (typeof args.limit === 'number') summary.limit = args.limit;
  if (typeof args.maxResults === 'number') summary.max_results = args.maxResults;
  if (typeof args.offset === 'number') summary.offset = args.offset;
  if (typeof args.compact === 'boolean') summary.compact = args.compact;
  if (typeof args.maxBodyLines === 'number') summary.max_body_lines = args.maxBodyLines;
  if (typeof args.maxDepth === 'number') summary.max_depth = args.maxDepth;
  if (Array.isArray(args.functions)) summary.functions_count = args.functions.length;
  if (Array.isArray(args.queries)) summary.queries_count = args.queries.length;
  return summary;
}

export function createTelemetryEvent(
  context: TelemetryContext,
  event: Omit<TelemetryEvent, 'schema_version' | 'server_version' | 'session_id' | 'workspace_id'>,
): TelemetryEvent {
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    server_version: context.serverVersion,
    session_id: context.sessionId,
    workspace_id: context.workspaceId,
    ...event,
  };
}

function extractResultCount(payload: unknown): { value: number | null; state: TelemetryResultCountState } {
  if (payload === null || typeof payload === 'undefined') return { value: null, state: 'unknown' };
  if (Array.isArray(payload)) return { value: payload.length, state: 'measured' };
  if (typeof payload !== 'object') return { value: null, state: 'na' };
  const record = payload as Record<string, unknown>;
  if (typeof record.count === 'number') return { value: record.count, state: 'measured' };
  if (typeof record.functionCount === 'number') return { value: record.functionCount, state: 'measured' };
  if (typeof record.queryCount === 'number') return { value: record.queryCount, state: 'measured' };
  if (Array.isArray(record.matches)) return { value: record.matches.length, state: 'measured' };
  if (Array.isArray(record.references)) return { value: record.references.length, state: 'measured' };
  if (Array.isArray(record.results)) return { value: record.results.length, state: 'measured' };
  if (Array.isArray(record.projects)) return { value: record.projects.length, state: 'measured' };
  if (Array.isArray(record.entrypoints)) return { value: record.entrypoints.length, state: 'measured' };
  if (Array.isArray(record.trace)) return { value: record.trace.length, state: 'measured' };
  if (Array.isArray(record.mutations)) return { value: record.mutations.length, state: 'measured' };
  if (Array.isArray(record.callers)) return { value: record.callers.length, state: 'measured' };
  if (Array.isArray(record.callees)) return { value: record.callees.length, state: 'measured' };
  if (Array.isArray(record.related)) return { value: record.related.length, state: 'measured' };
  if (record.body !== undefined && record.symbol && typeof record.symbol === 'object') {
    return { value: 1, state: 'measured' };
  }
  if (record.analysis && typeof record.analysis === 'object') {
    const analysis = record.analysis as Record<string, unknown>;
    if (Array.isArray(analysis.references)) return { value: analysis.references.length, state: 'measured' };
    if (typeof analysis.definitionCount === 'number') return { value: analysis.definitionCount, state: 'measured' };
  }
  return { value: null, state: 'na' };
}

function extractToolError(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.content) || payload.content.length === 0) return 'Tool error';
  const first = payload.content[0] as Record<string, unknown>;
  if (typeof first.text !== 'string' || first.text.length === 0) return 'Tool error';
  try {
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    if (typeof parsed.message === 'string' && parsed.message.length > 0) return parsed.message;
  } catch {
    // Legacy string errors.
  }
  return first.text;
}

function extractToolErrorKind(payload: Record<string, unknown>): string | null {
  if (!Array.isArray(payload.content) || payload.content.length === 0) return 'internal_error';
  const first = payload.content[0] as Record<string, unknown>;
  if (typeof first.text !== 'string' || first.text.length === 0) return 'internal_error';
  try {
    const parsed = JSON.parse(first.text) as Record<string, unknown>;
    return typeof parsed.error_kind === 'string' ? parsed.error_kind : 'internal_error';
  } catch {
    return 'internal_error';
  }
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
