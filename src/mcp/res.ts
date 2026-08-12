import * as fs from 'fs';
import * as path from 'path';

/**
 * Read-only Windows `.res` inspection. The format is a sequence of DWORD-
 * aligned records with a variable-length type/name header and arbitrary data.
 * We expose metadata and bounded previews; callers never receive a resource
 * blob or a write API.
 */
export const MAX_RES_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_RES_PREVIEW_BYTES = 256;
export const MAX_RES_ENTRIES = 1000;
export const MAX_STRING_TABLE_BYTES = 4 * 1024 * 1024;
export const MAX_STRING_TABLE_VALUES = 1000;
export const MAX_STRING_VALUE_CHARS = 2048;

export type ResResourceId =
  | { kind: 'ordinal'; value: number }
  | { kind: 'name'; value: string };

export interface ResEntry {
  offset: number;
  dataSize: number;
  headerSize: number;
  dataOffset: number;
  dataEnd: number;
  type: ResResourceId;
  typeLabel: string;
  name: ResResourceId;
  languageId: number;
  dataVersion: number;
  memoryFlags: number;
  version: number;
  characteristics: number;
  dataPreviewHex: string;
  dataPreviewTruncated: boolean;
}

export interface ResString {
  id: number;
  value: string;
  block: number;
  index: number;
  truncated: boolean;
}

export interface ResParseSuccess {
  ok: true;
  file?: string;
  fileSize: number;
  entries: ResEntry[];
  entryCount: number;
  entriesTruncated: boolean;
  stringTable: ResString[];
  stringTableTruncated: boolean;
}

export interface ResParseFailure {
  ok: false;
  errorKind: 'invalid_args' | 'not_found' | 'internal_error';
  message: string;
  details: Record<string, unknown>;
}

export type ResParseResult = ResParseSuccess | ResParseFailure;

export interface InspectResOptions {
  previewBytes?: number;
}

const STANDARD_RESOURCE_TYPES: Record<number, string> = {
  1: 'CURSOR',
  2: 'BITMAP',
  3: 'ICON',
  4: 'MENU',
  5: 'DIALOG',
  6: 'STRING',
  7: 'FONTDIR',
  8: 'FONT',
  9: 'ACCELERATOR',
  10: 'RCDATA',
  11: 'MESSAGETABLE',
  12: 'GROUP_CURSOR',
  14: 'GROUP_ICON',
  16: 'VERSION',
  17: 'DLGINIT',
  19: 'PLUGPLAY',
  20: 'VXD',
  21: 'ANI_CURSOR',
  22: 'ANI_ICON',
  23: 'HTML',
  24: 'MANIFEST',
};

export function inspectResFile(
  rootDir: string,
  fileArg: string,
  options: InspectResOptions = {},
): ResParseResult {
  const cleaned = fileArg.trim().replace(/\\/g, '/');
  if (!cleaned || !/\.res$/i.test(cleaned)) {
    return failure('invalid_args', `Expected a .res file: ${fileArg}`, { file: fileArg });
  }
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, cleaned);
  let realRoot = root;
  try { realRoot = fs.realpathSync(root); } catch { /* use lexical root guard below */ }
  if (!isWithin(root, candidate)) {
    return failure('invalid_args', 'The .res file must remain inside the configured workspace.', {
      file: fileArg,
      workspace_root: root,
    });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(candidate);
  } catch {
    return failure('not_found', `Resource file not found: ${fileArg}`, { file: fileArg });
  }
  if (!stat.isFile()) return failure('not_found', `Resource path is not a file: ${fileArg}`, { file: fileArg });
  if (stat.size > MAX_RES_FILE_BYTES) {
    return failure('invalid_args', `Resource file exceeds the ${MAX_RES_FILE_BYTES} byte safety limit.`, {
      file: fileArg,
      size: stat.size,
      max_size: MAX_RES_FILE_BYTES,
    });
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(candidate);
  } catch {
    return failure('not_found', `Resource file disappeared before it could be read: ${fileArg}`, { file: fileArg });
  }
  if (!isWithin(realRoot, realPath)) {
    return failure('invalid_args', 'The .res file resolves outside the configured workspace.', {
      file: fileArg,
      workspace_root: realRoot,
    });
  }
  let realStat = stat;
  try { realStat = fs.statSync(realPath); } catch {
    return failure('not_found', `Resource file disappeared before it could be read: ${fileArg}`, { file: fileArg });
  }
  if (realStat.size > MAX_RES_FILE_BYTES) {
    return failure('invalid_args', `Resource file grew beyond the ${MAX_RES_FILE_BYTES} byte safety limit while it was being inspected.`, {
      file: fileArg,
      size: realStat.size,
      max_size: MAX_RES_FILE_BYTES,
    });
  }

  try {
    const bytes = fs.readFileSync(realPath);
    if (bytes.length > MAX_RES_FILE_BYTES) {
      return failure('invalid_args', `Resource file grew beyond the ${MAX_RES_FILE_BYTES} byte safety limit while it was being read.`, {
        file: fileArg,
        size: bytes.length,
        max_size: MAX_RES_FILE_BYTES,
      });
    }
    const parsed = parseResBuffer(bytes, options);
    if (!parsed.ok) return parsed;
    return {
      ...parsed,
      file: path.relative(realRoot, realPath).replace(/\\/g, '/'),
    };
  } catch (error) {
    return failure('internal_error', `Could not read resource file: ${error instanceof Error ? error.message : String(error)}`, {
      file: fileArg,
    });
  }
}

/** Parse a `.res` byte buffer without allocating any resource payload. */
export function parseResBuffer(bytes: Uint8Array, options: InspectResOptions = {}): ResParseResult {
  if (bytes.length > MAX_RES_FILE_BYTES) {
    return failure('invalid_args', `Resource buffer exceeds the ${MAX_RES_FILE_BYTES} byte safety limit.`, {
      size: bytes.length,
      max_size: MAX_RES_FILE_BYTES,
    });
  }
  const previewBytes = clampPreview(options.previewBytes);
  const entries: ResEntry[] = [];
  const stringTable: ResString[] = [];
  let offset = 0;
  let entryCount = 0;
  let entriesTruncated = false;
  let stringTableTruncated = false;

  while (offset < bytes.length) {
    if (bytes.length - offset < 8) {
      return failure('invalid_args', 'Truncated .res record prefix.', { offset, file_size: bytes.length });
    }
    const dataSize = readU32(bytes, offset);
    const headerSize = readU32(bytes, offset + 4);
    if (dataSize === null || headerSize === null) {
      return failure('invalid_args', 'Truncated .res record prefix.', { offset, file_size: bytes.length });
    }
    if (dataSize === 0 && headerSize === 0) break;
    if (headerSize < 8 || headerSize > bytes.length - offset) {
      return failure('invalid_args', 'Invalid .res header size.', { offset, header_size: headerSize, file_size: bytes.length });
    }

    const headerEnd = offset + headerSize;
    let cursor = offset + 8;
    const type = readResourceId(bytes, cursor, headerEnd);
    if (!type.ok) return failure('invalid_args', type.message, { offset, field: 'type', ...type.details });
    cursor = type.next;
    const name = readResourceId(bytes, cursor, headerEnd);
    if (!name.ok) return failure('invalid_args', name.message, { offset, field: 'name', ...name.details });
    cursor = name.next;
    if (cursor + 16 > headerEnd) {
      return failure('invalid_args', 'Truncated .res fixed header fields.', { offset, header_size: headerSize });
    }

    const dataVersion = readU32(bytes, cursor)!;
    const memoryFlags = readU16(bytes, cursor + 4)!;
    const languageId = readU16(bytes, cursor + 6)!;
    const version = readU32(bytes, cursor + 8)!;
    const characteristics = readU32(bytes, cursor + 12)!;
    const dataOffset = align4(headerEnd);
    if (dataOffset > bytes.length || dataSize > bytes.length - dataOffset) {
      return failure('invalid_args', 'Truncated .res resource data.', {
        offset,
        data_offset: dataOffset,
        data_size: dataSize,
        file_size: bytes.length,
      });
    }
    const dataEnd = dataOffset + dataSize;
    const nextOffset = align4(dataEnd);
    if (nextOffset > bytes.length && dataEnd !== bytes.length) {
      return failure('invalid_args', 'Truncated .res record padding.', { offset, next_offset: nextOffset, file_size: bytes.length });
    }

    // Win32 resource files commonly begin with a 32-byte null resource
    // header. At offset zero it is a format marker, not an application entry.
    if (
      offset === 0
      && dataSize === 0
      && headerSize === 32
      && type.value.kind === 'ordinal'
      && type.value.value === 0
      && name.value.kind === 'ordinal'
      && name.value.value === 0
      && dataVersion === 0
      && memoryFlags === 0
      && languageId === 0
      && version === 0
      && characteristics === 0
    ) {
      if (nextOffset <= offset) return failure('invalid_args', 'Invalid .res null-header alignment.', { offset, next_offset: nextOffset });
      offset = nextOffset;
      continue;
    }

    entryCount += 1;
    const entry: ResEntry = {
      offset,
      dataSize,
      headerSize,
      dataOffset,
      dataEnd,
      type: type.value,
      typeLabel: resourceTypeLabel(type.value),
      name: name.value,
      languageId,
      dataVersion,
      memoryFlags,
      version,
      characteristics,
      dataPreviewHex: toHex(bytes.slice(dataOffset, Math.min(dataEnd, dataOffset + previewBytes))),
      dataPreviewTruncated: dataSize > previewBytes,
    };
    if (entries.length < MAX_RES_ENTRIES) entries.push(entry);
    else entriesTruncated = true;

    if (type.value.kind === 'ordinal' && type.value.value === 6) {
      if (dataSize > MAX_STRING_TABLE_BYTES) {
        stringTableTruncated = true;
      } else {
        const strings = parseStringTable(bytes.slice(dataOffset, dataEnd), name.value);
        if (!strings.ok) return failure('invalid_args', strings.message, { offset, field: 'string_table', ...strings.details });
        if (stringTable.length < MAX_STRING_TABLE_VALUES) {
          const remaining = MAX_STRING_TABLE_VALUES - stringTable.length;
          stringTable.push(...strings.values.slice(0, remaining));
          if (strings.values.length > remaining) stringTableTruncated = true;
        } else {
          stringTableTruncated = true;
        }
      }
    }

    if (nextOffset <= offset) return failure('invalid_args', 'Invalid .res record alignment.', { offset, next_offset: nextOffset });
    offset = nextOffset;
  }

  return {
    ok: true,
    fileSize: bytes.length,
    entries,
    entryCount,
    entriesTruncated,
    stringTable,
    stringTableTruncated,
  };
}

interface ResourceIdSuccess {
  ok: true;
  value: ResResourceId;
  next: number;
}

interface ResourceIdFailure {
  ok: false;
  message: string;
  details: Record<string, unknown>;
}

type ResourceIdResult = ResourceIdSuccess | ResourceIdFailure;

function readResourceId(bytes: Uint8Array, offset: number, limit: number): ResourceIdResult {
  const first = readU16(bytes, offset);
  if (first === null || offset + 2 > limit) return parseFailure('Truncated .res resource id.', { needed: offset + 2, header_end: limit });
  if (first === 0xffff) {
    const ordinal = readU16(bytes, offset + 2);
    if (ordinal === null || offset + 4 > limit) return parseFailure('Truncated .res ordinal id.', { needed: offset + 4, header_end: limit });
    return { ok: true, value: { kind: 'ordinal', value: ordinal }, next: offset + 4 };
  }

  const units: number[] = [];
  let cursor = offset;
  while (cursor + 2 <= limit) {
    const unit = readU16(bytes, cursor)!;
    cursor += 2;
    if (unit === 0) return { ok: true, value: { kind: 'name', value: String.fromCharCode(...units) }, next: cursor };
    if (units.length >= 2048) return parseFailure('Resource name exceeds the safety limit.', { max_units: 2048 });
    units.push(unit);
  }
  return parseFailure('Truncated .res Unicode resource name.', { header_end: limit });
}

function parseStringTable(bytes: Uint8Array, blockId: ResResourceId): { ok: true; values: ResString[] } | ResourceIdFailure {
  if (blockId.kind !== 'ordinal') return parseFailure('String-table resource name is not an ordinal block id.', {});
  const block = blockId.value;
  if (block < 1) return parseFailure('String-table resource block id must be positive.', { block });
  let offset = 0;
  const values: ResString[] = [];
  for (let index = 0; index < 16; index += 1) {
    const length = readU16(bytes, offset);
    if (length === null) return parseFailure('Truncated string-table length.', { index, offset, file_size: bytes.length });
    offset += 2;
    const byteLength = length * 2;
    if (byteLength > bytes.length - offset) return parseFailure('Truncated string-table value.', { index, offset, length, file_size: bytes.length });
    if (length > 0) {
      const value = Buffer.from(bytes.slice(offset, offset + byteLength)).toString('utf16le');
      values.push({
        // The low four bits are the index and the block name is
        // floor(stringId / 16) + 1, so block 1 contains IDs 0..15.
        id: (block - 1) * 16 + index,
        value: value.slice(0, MAX_STRING_VALUE_CHARS),
        block,
        index,
        truncated: value.length > MAX_STRING_VALUE_CHARS,
      });
    }
    offset += byteLength;
  }
  if (offset !== bytes.length) return parseFailure('String-table resource has trailing bytes.', { used: offset, file_size: bytes.length });
  return { ok: true, values };
}

function resourceTypeLabel(id: ResResourceId): string {
  if (id.kind === 'name') return id.value;
  return STANDARD_RESOURCE_TYPES[id.value] || `#${id.value}`;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function readU16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (bytes[offset]
    | (bytes[offset + 1] << 8)
    | (bytes[offset + 2] << 16)
    | (bytes[offset + 3] * 0x1000000)) >>> 0;
}

function clampPreview(value: number | undefined): number {
  if (!Number.isFinite(value)) return 64;
  return Math.min(Math.max(Math.floor(value!), 0), MAX_RES_PREVIEW_BYTES);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isWithin(rootDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function parseFailure(message: string, details: Record<string, unknown>): ResourceIdFailure {
  return { ok: false, message, details };
}

function failure(
  errorKind: ResParseFailure['errorKind'],
  message: string,
  details: Record<string, unknown>,
): ResParseFailure {
  return { ok: false, errorKind, message, details };
}
