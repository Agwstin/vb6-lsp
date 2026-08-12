import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const width = 128;
const height = 128;
const pixels = Buffer.alloc(width * height * 4, 0);
const background = [31, 111, 235, 255];
const foreground = [255, 255, 255, 255];

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) setPixel(x, y, background);
}

const glyphs = {
  V: ['10001', '10001', '10001', '10001', '01010', '01010', '00100'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
};
const scale = 7;
const gap = 5;
const glyphWidth = 5 * scale;
const glyphHeight = 7 * scale;
const totalWidth = glyphWidth * 3 + gap * 2;
const startX = Math.floor((width - totalWidth) / 2);
const startY = Math.floor((height - glyphHeight) / 2);

for (const [glyphIndex, glyphName] of [...'VB6'].entries()) {
  const rows = glyphs[glyphName];
  const xOffset = startX + glyphIndex * (glyphWidth + gap);
  for (let row = 0; row < rows.length; row++) {
    for (let column = 0; column < rows[row].length; column++) {
      if (rows[row][column] !== '1') continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          setPixel(xOffset + column * scale + x, startY + row * scale + y, foreground);
        }
      }
    }
  }
}

const scanlines = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y++) {
  scanlines[y * (width * 4 + 1)] = 0;
  pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', Buffer.from([0, 0, 0, width, 0, 0, 0, height, 8, 6, 0, 0, 0])),
  chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const output = path.resolve(process.argv[2] || 'images/icon.png');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, png);
process.stdout.write(`${output} ${width}x${height}\n`);

function setPixel(x, y, rgba) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  pixels.set(rgba, offset);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
