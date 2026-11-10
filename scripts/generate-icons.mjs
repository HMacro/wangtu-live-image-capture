import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "extension", "icons");
const sizes = [16, 32, 48, 128];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    rgba.copy(rows, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function segmentDistance(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function insideRoundedSquare(x, y, size) {
  const margin = size * 0.035;
  const radius = size * 0.23;
  const left = margin;
  const top = margin;
  const right = size - margin;
  const bottom = size - margin;
  const nearestX = Math.max(left + radius, Math.min(right - radius, x));
  const nearestY = Math.max(top + radius, Math.min(bottom - radius, y));
  return Math.hypot(x - nearestX, y - nearestY) <= radius;
}

function insideArrow(x, y, size) {
  const width = size * 0.105;
  const start = size * 0.29;
  const tip = size * 0.71;
  const head = size * 0.47;
  return segmentDistance(x, y, start, start, tip, tip) <= width / 2
    || segmentDistance(x, y, head, tip, tip, tip) <= width / 2
    || segmentDistance(x, y, tip, head, tip, tip) <= width / 2;
}

function renderIcon(size) {
  const samples = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let backgroundSamples = 0;
      let arrowSamples = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          if (insideRoundedSquare(px, py, size)) backgroundSamples += 1;
          if (insideArrow(px, py, size)) arrowSamples += 1;
        }
      }
      const total = samples * samples;
      const backgroundAlpha = backgroundSamples / total;
      const arrowAlpha = arrowSamples / total;
      const alpha = arrowAlpha + backgroundAlpha * (1 - arrowAlpha);
      const index = (y * size + x) * 4;
      if (!alpha) continue;
      const background = [23, 26, 21];
      const arrow = [184, 243, 75];
      const arrowMix = arrowAlpha / alpha;
      pixels[index] = Math.round(background[0] * (1 - arrowMix) + arrow[0] * arrowMix);
      pixels[index + 1] = Math.round(background[1] * (1 - arrowMix) + arrow[1] * arrowMix);
      pixels[index + 2] = Math.round(background[2] * (1 - arrowMix) + arrow[2] * arrowMix);
      pixels[index + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, pixels);
}

await mkdir(output, { recursive: true });
for (const size of sizes) await writeFile(resolve(output, `icon${size}.png`), renderIcon(size));
console.log(`Generated extension icons: ${sizes.join(", ")} px`);
