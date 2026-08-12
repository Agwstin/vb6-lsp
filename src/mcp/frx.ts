import * as fs from 'fs';
import * as path from 'path';

/**
 * The first FRX slice is deliberately read-only and bounded.  A companion
 * resource can be large, and vendor control bags do not have a safe generic
 * decoder, so callers must never receive an unbounded binary payload.
 */
export const MAX_FRX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_FRX_VALUE_BYTES = 4 * 1024 * 1024;
export const DEFAULT_FRX_PREVIEW_BYTES = 64;
export const MAX_FRX_PREVIEW_BYTES = 256;
export const MAX_FRX_LIST_ITEMS = 200;

export type FrxValueKind =
  | 'picture'
  | 'font'
  | 'string_short'
  | 'string_medium'
  | 'string_long'
  | 'list'
  | 'opaque';

export interface FrxReference {
  file: string;
  offset: number;
  dollar: boolean;
}

export interface FrxDecodedText {
  type: 'text';
  text: string;
  encoding: 'ansi' | 'utf16le';
  byteLength: number;
  /** Present only when a medium record's declared size was one byte too large at EOF. */
  declaredByteLength?: number;
  lengthAdjusted?: boolean;
}

export interface FrxDecodedPicture {
  type: 'picture';
  format: 'bmp' | 'ico' | 'cur' | 'gif' | 'jpeg' | 'png' | 'wmf' | 'emf' | 'unknown';
  dataByteLength: number;
  byteLength: number;
  previewHex: string;
}

export interface FrxDecodedFont {
  type: 'font';
  name: string;
  sizePt: number;
  weight: number;
  charset: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  byteLength: number;
}

export interface FrxDecodedList {
  type: 'list';
  signature: number;
  items: string[];
  itemCount: number;
  truncated: boolean;
  byteLength: number;
}

export interface FrxDecodedOpaque {
  type: 'opaque';
  reason: string;
  remainingByteLength: number;
  previewHex: string;
}

export interface FrxDecodedEmpty {
  type: 'empty';
  byteLength: number;
}

export type FrxDecodedValue =
  | FrxDecodedText
  | FrxDecodedPicture
  | FrxDecodedFont
  | FrxDecodedList
  | FrxDecodedOpaque
  | FrxDecodedEmpty;

export interface FrxInspectionSuccess {
  ok: true;
  status: 'decoded' | 'opaque' | 'empty';
  sourceFile: string;
  companionFile: string;
  companionSize: number;
  reference: FrxReference;
  property: string | null;
  kind: FrxValueKind;
  value: FrxDecodedValue;
}

export interface FrxInspectionFailure {
  ok: false;
  errorKind: 'invalid_args' | 'not_found' | 'internal_error';
  message: string;
  details: Record<string, unknown>;
}

export type FrxInspectionResult = FrxInspectionSuccess | FrxInspectionFailure;

export interface InspectFrxOptions {
  property?: string;
  kind?: string;
  previewBytes?: number;
}

/**
 * Parse the value portion used by VB6 form designers, for example:
 *   "Form1.frx":0000
 *   $"Form1.frx":0BCA
 *
 * Only companion files are accepted.  The returned offset is a byte offset,
 * not a record number or a line number.
 */
export function parseFrxReference(value: string): FrxReference | null {
  const trimmed = value.trim();
  const match = /^\s*(\$)?\s*"([^"]+)"\s*:\s*([0-9a-f]+)/i.exec(trimmed);
  if (!match) return null;
  const file = match[2];
  if (!/\.(?:frx|ctx)$/i.test(file) || file.includes('\0')) return null;
  const offset = Number.parseInt(match[3], 16);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 0xffffffff) return null;
  return {
    file,
    offset,
    dollar: Boolean(match[1]),
  };
}

/** Infer the safest supported decoder from a VB6 designer property. */
export function kindForFrxProperty(property: string | undefined, dollar: boolean): FrxValueKind {
  const normalized = (property || '').trim().split('.').pop()!.split('(')[0].toLowerCase();
  switch (normalized) {
    case 'picture':
    case 'icon':
    case 'image':
    case 'mouseicon':
    case 'dragicon':
    case 'toolboxbitmap':
    case 'disabledpicture':
    case 'downpicture':
    case 'maskpicture':
    case 'tabpicture':
      return 'picture';
    case 'font':
    case 'mousefont':
      return 'font';
    case 'list':
      return 'list';
    case 'caption':
    case 'text':
    case 'textrtf':
    case 'tag':
    case 'tooltiptext':
    case 'title':
      return dollar ? 'string_long' : 'string_short';
    default:
      // A bare `$"...":N` is unambiguously the long-string framing.  For an
      // unknown short property, remain opaque rather than guessing a control
      // vendor's private serialization.
      return dollar && !normalized ? 'string_long' : 'opaque';
  }
}

/** Normalize the explicit kind accepted by the MCP tool. */
export function normalizeFrxKind(value: string | undefined): FrxValueKind | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, '_');
  if (
    normalized === 'picture'
    || normalized === 'font'
    || normalized === 'string_short'
    || normalized === 'string_medium'
    || normalized === 'string_long'
    || normalized === 'list'
    || normalized === 'opaque'
  ) {
    return normalized;
  }
  return null;
}

function isWithin(rootDir: string, candidate: string): boolean {
  const root = path.resolve(rootDir);
  const resolved = path.resolve(candidate);
  const relative = path.relative(root, resolved);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function relativeFile(rootDir: string, filePath: string): string {
  return path.relative(path.resolve(rootDir), path.resolve(filePath)).replace(/\\/g, '/');
}

/** Inspect one companion reference without writing or returning arbitrary bytes. */
export function inspectFrxReference(
  rootDir: string,
  sourceFile: string,
  value: string,
  options: InspectFrxOptions = {},
): FrxInspectionResult {
  const reference = parseFrxReference(value);
  if (!reference) {
    return failure('invalid_args', `Not a VB6 .frx/.ctx reference: ${value}`, { value });
  }

  const explicitKind = normalizeFrxKind(options.kind);
  if (options.kind && !explicitKind) {
    return failure('invalid_args', `Unsupported FRX kind: ${options.kind}`, {
      supported_kinds: ['picture', 'font', 'string_short', 'string_medium', 'string_long', 'list', 'opaque'],
    });
  }
  const requestedKind = explicitKind || kindForFrxProperty(options.property, reference.dollar);
  const root = path.resolve(rootDir);
  const source = path.resolve(sourceFile);
  let realRoot = root;
  let realSource = source;
  try {
    realRoot = fs.realpathSync(root);
    realSource = fs.realpathSync(source);
  } catch {
    // The indexed source is expected to exist, but keep the normal path guard
    // as the fallback if a file disappears between indexing and inspection.
  }
  if (!isWithin(realRoot, realSource)) {
    return failure('invalid_args', 'The source file must be inside the configured workspace.', {
      source_file: source,
      workspace_root: realRoot,
    });
  }

  const companion = path.resolve(path.dirname(source), reference.file);
  if (!isWithin(root, companion)) {
    return failure('invalid_args', 'The FRX/CTX companion must remain inside the configured workspace.', {
      companion_file: reference.file,
      workspace_root: root,
    });
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(companion);
  } catch {
    return failure('not_found', `FRX/CTX companion not found: ${reference.file}`, {
      companion_file: relativeFile(root, companion),
    });
  }
  if (!stat.isFile()) {
    return failure('not_found', `FRX/CTX companion is not a file: ${reference.file}`, {
      companion_file: relativeFile(root, companion),
    });
  }
  let realCompanion = companion;
  try {
    realCompanion = fs.realpathSync(companion);
  } catch {
    return failure('not_found', `FRX/CTX companion disappeared before it could be read: ${reference.file}`, {
      companion_file: relativeFile(root, companion),
    });
  }
  if (!isWithin(realRoot, realCompanion)) {
    return failure('invalid_args', 'The FRX/CTX companion resolves outside the configured workspace.', {
      companion_file: relativeFile(root, companion),
      workspace_root: realRoot,
    });
  }
  let realStat = stat;
  try { realStat = fs.statSync(realCompanion); } catch {
    return failure('not_found', `FRX/CTX companion disappeared before it could be read: ${reference.file}`, {
      companion_file: relativeFile(root, companion),
    });
  }
  if (realStat.size > MAX_FRX_FILE_BYTES) {
    return failure('invalid_args', `FRX/CTX companion exceeds the ${MAX_FRX_FILE_BYTES} byte safety limit.`, {
      companion_file: relativeFile(root, companion),
      size: realStat.size,
      max_size: MAX_FRX_FILE_BYTES,
    });
  }

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(realCompanion);
  } catch (error) {
    return failure('internal_error', `Could not read FRX/CTX companion: ${error instanceof Error ? error.message : String(error)}`, {
      companion_file: relativeFile(root, companion),
    });
  }
  if (bytes.length > MAX_FRX_FILE_BYTES) {
    return failure('invalid_args', `FRX/CTX companion grew beyond the ${MAX_FRX_FILE_BYTES} byte safety limit while it was read.`, {
      companion_file: relativeFile(root, companion),
      size: bytes.length,
      max_size: MAX_FRX_FILE_BYTES,
    });
  }

  // A medium text record is unambiguously marked with 0xFF. Only infer it
  // for the normal property-derived short-string path; an explicit kind is
  // always honored so callers can inspect malformed/vendor records safely.
  const kind = !explicitKind
    && requestedKind === 'string_short'
    && bytes[reference.offset] === 0xff
    ? 'string_medium'
    : requestedKind;
  const decoded = decodeFrxValue(bytes, reference.offset, kind, options.previewBytes);
  if (!decoded.ok) {
    return failure('invalid_args', decoded.message, {
      companion_file: relativeFile(root, companion),
      offset: reference.offset,
      kind,
      ...decoded.details,
    });
  }

  const status = decoded.value.type === 'opaque'
    ? 'opaque'
    : decoded.value.type === 'empty' ? 'empty' : 'decoded';
  return {
    ok: true,
    status,
    sourceFile: relativeFile(root, source),
    companionFile: relativeFile(root, companion),
    companionSize: bytes.length,
    reference,
    property: options.property?.trim() || null,
    kind,
    value: decoded.value,
  };
}

interface DecodeFailure {
  ok: false;
  message: string;
  details: Record<string, unknown>;
}

interface DecodeSuccess {
  ok: true;
  value: FrxDecodedValue;
}

type DecodeResult = DecodeSuccess | DecodeFailure;

/** Decode only bounded, standard record shapes. This function never mutates input. */
export function decodeFrxValue(
  bytes: Uint8Array,
  offset: number,
  kind: FrxValueKind,
  previewBytes = DEFAULT_FRX_PREVIEW_BYTES,
): DecodeResult {
  if (bytes.length > MAX_FRX_FILE_BYTES) {
    return decodeFailure(`FRX buffer exceeds the ${MAX_FRX_FILE_BYTES} byte safety limit.`, {
      file_size: bytes.length,
      max_size: MAX_FRX_FILE_BYTES,
    });
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length) {
    return decodeFailure(`FRX offset 0x${Math.max(0, offset).toString(16).toUpperCase()} is outside the companion file.`, {
      offset,
      file_size: bytes.length,
    });
  }
  switch (kind) {
    case 'string_short':
      return decodeString(bytes, offset, 1);
    case 'string_medium':
      return decodeString(bytes, offset, 3);
    case 'string_long':
      return decodeString(bytes, offset, 4);
    case 'picture':
      return decodePicture(bytes, offset, clampPreview(previewBytes));
    case 'font':
      return decodeFont(bytes, offset);
    case 'list':
      return decodeList(bytes, offset);
    case 'opaque':
      return {
        ok: true,
        value: {
          type: 'opaque',
          reason: 'No safe standard decoder selected for this property.',
          remainingByteLength: bytes.length - offset,
          previewHex: toHex(bytes.slice(offset, offset + clampPreview(previewBytes))),
        },
      };
  }
  return decodeFailure('Unsupported FRX value kind.', { kind });
}

function decodeString(bytes: Uint8Array, offset: number, prefixBytes: 1 | 3 | 4): DecodeResult {
  const length = prefixBytes === 1
    ? (offset < bytes.length ? bytes[offset] : null)
    : prefixBytes === 3
      ? readMediumLength(bytes, offset)
      : readU32(bytes, offset);
  if (length === null) {
    return decodeFailure('FRX string length prefix is truncated.', { needed: prefixBytes, file_size: bytes.length });
  }
  if (prefixBytes === 3 && bytes[offset] !== 0xff) {
    return decodeFailure('FRX medium string marker is missing.', { offset, marker: bytes[offset] });
  }
  if (length > MAX_FRX_VALUE_BYTES) {
    return decodeFailure('FRX string exceeds the per-value safety limit.', {
      length,
      max_size: MAX_FRX_VALUE_BYTES,
    });
  }
  const start = offset + prefixBytes;
  let payloadLength = length;
  let end = start + payloadLength;
  // Some VB6 IDE versions wrote a medium record's declared size as N while
  // only N-1 payload bytes remained at EOF. Salvage exactly that one-byte
  // mismatch; larger truncations remain hard failures.
  const lengthAdjusted = prefixBytes === 3 && end - 1 === bytes.length;
  if (lengthAdjusted) {
    payloadLength -= 1;
    end -= 1;
  }
  if (end > bytes.length) {
    return decodeFailure('FRX string payload is truncated.', { needed: end, file_size: bytes.length });
  }
  const payload = bytes.slice(start, end);
  const utf16 = looksLikeUtf16Le(payload);
  return {
    ok: true,
    value: {
      type: 'text',
      text: utf16 ? decodeUtf16(payload) : decodeWindows1252(payload),
      encoding: utf16 ? 'utf16le' : 'ansi',
      byteLength: prefixBytes + payloadLength,
      ...(lengthAdjusted ? { declaredByteLength: prefixBytes + length, lengthAdjusted: true } : {}),
    },
  };
}

function readMediumLength(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 3 > bytes.length) return null;
  return readU16(bytes, offset + 1);
}

function decodePicture(bytes: Uint8Array, offset: number, previewBytes: number): DecodeResult {
  const outer = readU32(bytes, offset);
  if (outer === null) return decodeFailure('FRX picture length prefix is truncated.', { needed: offset + 4, file_size: bytes.length });
  const body = offset + 4;
  const standard = Buffer.from(bytes.slice(body, body + 4)).toString('latin1') === 'lt\0\0';
  const withClassId = Buffer.from(bytes.slice(body + 16, body + 20)).toString('latin1') === 'lt\0\0';
  if (!standard && !withClassId) return decodeFailure('FRX picture header is not a supported StdPicture record.', { offset });
  const headerBytes = withClassId ? 16 : 0;
  const magic = body + headerBytes;
  const dataLength = readU32(bytes, magic + 4);
  if (dataLength === null) return decodeFailure('FRX picture payload length is truncated.', { needed: magic + 8, file_size: bytes.length });
  if (dataLength > MAX_FRX_VALUE_BYTES) return decodeFailure('FRX picture exceeds the per-value safety limit.', { data_length: dataLength, max_size: MAX_FRX_VALUE_BYTES });
  const expectedOuter = dataLength + 8 + headerBytes;
  if (outer !== expectedOuter) return decodeFailure('FRX picture framing length does not match its payload.', { outer, expected_outer: expectedOuter });
  const start = magic + 8;
  const end = start + dataLength;
  if (end > bytes.length) return decodeFailure('FRX picture payload is truncated.', { needed: end, file_size: bytes.length });
  if (dataLength === 0) return { ok: true, value: { type: 'empty', byteLength: 4 + outer } };
  const data = bytes.slice(start, end);
  return {
    ok: true,
    value: {
      type: 'picture',
      format: detectImageFormat(data),
      dataByteLength: dataLength,
      byteLength: 4 + outer,
      previewHex: toHex(data.slice(0, previewBytes)),
    },
  };
}

function decodeFont(bytes: Uint8Array, offset: number): DecodeResult {
  const minimum = offset + 11;
  if (minimum > bytes.length) return decodeFailure('FRX font header is truncated.', { needed: minimum, file_size: bytes.length });
  const charset = readU16(bytes, offset + 1)!;
  const flags = bytes[offset + 3];
  const weight = readU16(bytes, offset + 4)!;
  const sizeRaw = readU32(bytes, offset + 6)!;
  const nameLength = bytes[offset + 10];
  const nameEnd = offset + 11 + nameLength;
  if (nameEnd > bytes.length) return decodeFailure('FRX font name is truncated.', { needed: nameEnd, file_size: bytes.length });
  const name = decodeWindows1252(bytes.slice(offset + 11, nameEnd));
  return {
    ok: true,
    value: {
      type: 'font',
      name,
      sizePt: sizeRaw / 10000,
      weight,
      charset,
      bold: weight >= 700 || (flags & 0x01) !== 0,
      italic: (flags & 0x02) !== 0,
      underline: (flags & 0x04) !== 0,
      strikethrough: (flags & 0x08) !== 0,
      byteLength: 11 + nameLength,
    },
  };
}

function decodeList(bytes: Uint8Array, offset: number): DecodeResult {
  const count = readU16(bytes, offset);
  if (count === null) return decodeFailure('FRX list count is truncated.', { needed: offset + 2, file_size: bytes.length });
  if (count === 0) {
    return { ok: true, value: { type: 'list', signature: 0, items: [], itemCount: 0, truncated: false, byteLength: 2 } };
  }
  const signature = readU16(bytes, offset + 2);
  if (signature === null) return decodeFailure('FRX list signature is truncated.', { needed: offset + 4, file_size: bytes.length });
  let cursor = offset + 4;
  const items: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const length = readU16(bytes, cursor);
    if (length === null) return decodeFailure('FRX list item length is truncated.', { item: index, needed: cursor + 2, file_size: bytes.length });
    cursor += 2;
    const end = cursor + length;
    if (end > bytes.length) return decodeFailure('FRX list item is truncated.', { item: index, needed: end, file_size: bytes.length });
    if (index < MAX_FRX_LIST_ITEMS) items.push(decodeWindows1252(bytes.slice(cursor, end)));
    cursor = end;
  }
  return {
    ok: true,
    value: {
      type: 'list',
      signature,
      items,
      itemCount: count,
      truncated: count > MAX_FRX_LIST_ITEMS,
      byteLength: cursor - offset,
    },
  };
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

function looksLikeUtf16Le(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes.length % 2 !== 0) return false;
  let zeroHighBytes = 0;
  for (let i = 1; i < bytes.length; i += 2) if (bytes[i] === 0) zeroHighBytes += 1;
  return zeroHighBytes * 5 >= (bytes.length / 2) * 4;
}

function decodeUtf16(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf16le');
}

const WINDOWS_1252_EXTENDED: Readonly<Record<number, string>> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

/** Decode the Windows-1252 bytes used by VB6 FRX text records. */
function decodeWindows1252(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) {
      text += WINDOWS_1252_EXTENDED[byte] || '\uFFFD';
    } else {
      text += String.fromCharCode(byte);
    }
  }
  return text;
}

function detectImageFormat(data: Uint8Array): FrxDecodedPicture['format'] {
  if (data.length >= 2 && data[0] === 0x42 && data[1] === 0x4d) return 'bmp';
  if (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0) return 'ico';
  if (data.length >= 4 && data[0] === 0 && data[1] === 0 && data[2] === 2 && data[3] === 0) return 'cur';
  if (data.length >= 4 && Buffer.from(data.slice(0, 4)).toString() === 'GIF8') return 'gif';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
  if (data.length >= 4 && ((data[0] === 0xd7 && data[1] === 0xcd && data[2] === 0xc6 && data[3] === 0x9a) || (data[0] === 1 && data[1] === 0 && data[2] === 9 && data[3] === 0))) return 'wmf';
  if (data.length >= 44 && data[40] === 0x20 && data[41] === 0x45 && data[42] === 0x4d && data[43] === 0x46) return 'emf';
  return 'unknown';
}

function clampPreview(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FRX_PREVIEW_BYTES;
  return Math.min(Math.max(Math.floor(value), 0), MAX_FRX_PREVIEW_BYTES);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeFailure(message: string, details: Record<string, unknown>): DecodeFailure {
  return { ok: false, message, details };
}

function failure(
  errorKind: FrxInspectionFailure['errorKind'],
  message: string,
  details: Record<string, unknown>,
): FrxInspectionFailure {
  return { ok: false, errorKind, message, details };
}
