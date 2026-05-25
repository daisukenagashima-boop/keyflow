#!/usr/bin/env node
// Generates PNG icons for iOS home screen and PWA manifest.
// Run once: node generate-icons.js
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ─────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crc]);
}

// ── Rounded-rect SDF ──────────────────────────────────────────────────────
function rrSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2)
       + Math.min(Math.max(qx, qy), 0) - r;
}

// ── Draw one pixel: 3×3 key grid ──────────────────────────────────────────
// Row 0 (top):    teal accent  #01C1AF  — matches app's symbol/action keys
// Rows 1–2:       dark panel   #1c1c1c  — matches app's number keys
function drawPixel(x, y, sz) {
  const pad = sz * 0.115;
  const gap = sz * 0.033;
  const kw  = (sz - 2 * pad - 2 * gap) / 3;
  const kh  = kw;
  const r   = kw * 0.14;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = pad + col * (kw + gap) + kw / 2;
      const cy = pad + row * (kh + gap) + kh / 2;
      if (rrSDF(x, y, cx, cy, kw / 2, kh / 2, r) <= 0.8) {
        return row === 0
          ? [0x01, 0xC1, 0xAF, 0xff]   // teal
          : [0x1c, 0x1c, 0x1c, 0xff];  // dark panel
      }
    }
  }

  return [0x11, 0x11, 0x11, 0xff]; // background
}

// ── Build PNG ─────────────────────────────────────────────────────────────
function makePNG(sz) {
  const rows = [];
  for (let y = 0; y < sz; y++) {
    const row = Buffer.alloc(1 + sz * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < sz; x++) {
      const [r, g, b, a] = drawPixel(x, y, sz);
      row[1 + x * 4]     = r;
      row[1 + x * 4 + 1] = g;
      row[1 + x * 4 + 2] = b;
      row[1 + x * 4 + 3] = a;
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sz, 0); ihdr.writeUInt32BE(sz, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, 'public');
const targets = [
  { sz: 180, name: 'icon-apple.png' },
  { sz: 192, name: 'icon-192.png'   },
  { sz: 512, name: 'icon-512.png'   },
];
for (const { sz, name } of targets) {
  const png = makePNG(sz);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`  ${name}  ${png.length} bytes`);
}
console.log('done');
