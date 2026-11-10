'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(width, height, pixelFn) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TINTS = [
  [176, 152, 84],
  [110, 92, 40],
  [88, 80, 60],
  [60, 58, 50],
  [200, 175, 100],
  [214, 192, 128],
];

function scene(index) {
  const w = 720;
  const h = 540;
  const base = TINTS[index % TINTS.length];
  const horizon = Math.round(h * (0.55 + (index % 3) * 0.06));
  return makePng(w, h, (x, y) => {
    if (y < horizon) {
      const k = 0.35 + 0.5 * (y / horizon);
      const cloud = Math.sin((x + index * 90) / 110) * Math.sin(y / 70) > 0.72 ? 22 : 0;
      return [
        Math.min(255, Math.round(base[0] * k + 150 + cloud)),
        Math.min(255, Math.round(base[1] * k + 160 + cloud)),
        Math.min(255, Math.round(base[2] * k + 175 + cloud)),
      ];
    }
    const g = 0.42 - 0.32 * ((y - horizon) / (h - horizon));
    const stripe = Math.floor((x + index * 40) / 60) % 2 ? 1.08 : 1;
    const band = y > horizon + 34 && y < horizon + 48 ? 1.5 : 1;
    const s = g * stripe * band;
    return [
      Math.min(255, Math.round(base[0] * s)),
      Math.min(255, Math.round(base[1] * s)),
      Math.min(255, Math.round(base[2] * s)),
    ];
  });
}

function writePhoto(dir, name, index) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, scene(index));
  return '/photos/' + name;
}

module.exports = { scene, writePhoto, makePng };
