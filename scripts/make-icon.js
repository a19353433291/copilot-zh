// 生成 256x256 应用图标（ICO，多尺寸），纯 Node 无依赖实现 PNG 编码。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng(size) {
  // 圆角方形渐变底 + 白色「中」字（用几何块绘制，避免字体依赖）
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const r = size * 0.22;                  // 圆角半径
  const pad = size * 0.06;

  function inRounded(x, y) {
    const x0 = pad, y0 = pad, x1 = size - pad, y1 = size - pad;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    // 四角圆角
    const corners = [[x0 + r, y0 + r], [x1 - r, y0 + r], [x0 + r, y1 - r], [x1 - r, y1 - r]];
    if (x < x0 + r && y < y0 + r) return Math.hypot(x - corners[0][0], y - corners[0][1]) <= r;
    if (x > x1 - r && y < y0 + r) return Math.hypot(x - corners[1][0], y - corners[1][1]) <= r;
    if (x < x0 + r && y > y1 - r) return Math.hypot(x - corners[2][0], y - corners[2][1]) <= r;
    if (x > x1 - r && y > y1 - r) return Math.hypot(x - corners[3][0], y - corners[3][1]) <= r;
    return true;
  }

  // 「中」字几何：一竖 + 两口
  const s = size;
  const stroke = Math.max(2, Math.round(s * 0.055));
  const vx = cx - stroke / 2;
  const vTop = s * 0.24, vBot = s * 0.76;
  const boxW = s * 0.30, boxH = s * 0.145;
  const boxY1 = s * 0.30, boxY2 = s * 0.565;
  const boxX = cx - boxW / 2;

  function inZhong(x, y) {
    // 竖
    if (x >= vx && x <= vx + stroke && y >= vTop && y <= vBot) return true;
    // 上口
    const inBox = (bx, by, bw, bh) => {
      const insideOuter = x >= bx && x <= bx + bw && y >= by && y <= by + bh;
      if (!insideOuter) return false;
      const t = stroke;
      const insideInner = x >= bx + t && x <= bx + bw - t && y >= by + t && y <= by + bh - t;
      return !insideInner;
    };
    if (inBox(boxX, boxY1, boxW, boxH)) return true;
    if (inBox(boxX, boxY2, boxW, boxH)) return true;
    return false;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (!inRounded(x, y)) { px[i + 3] = 0; continue; }
      // 渐变
      const t = (x / size * 0.35 + y / size * 0.65);
      const r0 = Math.round(47 + t * (137 - 47));
      const g0 = Math.round(129 + t * (87 - 129));
      const b0 = Math.round(247 + t * (229 - 247));
      if (inZhong(x, y)) {
        px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
      } else {
        px[i] = r0; px[i + 1] = g0; px[i + 2] = b0; px[i + 3] = 255;
      }
    }
  }

  // 编码 PNG
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0;
    px.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// 生成 ICO（内含多种尺寸的 PNG）
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = sizes.map(s => ({ size: s, buf: makePng(s) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);

let offset = 6 + pngs.length * 16;
const dirs = [];
for (const p of pngs) {
  const d = Buffer.alloc(16);
  d[0] = p.size >= 256 ? 0 : p.size;
  d[1] = p.size >= 256 ? 0 : p.size;
  d[2] = 0; d[3] = 0;
  d.writeUInt16LE(1, 4);
  d.writeUInt16LE(32, 6);
  d.writeUInt32LE(p.buf.length, 8);
  d.writeUInt32LE(offset, 12);
  offset += p.buf.length;
  dirs.push(d);
}

const ico = Buffer.concat([header, ...dirs, ...pngs.map(p => p.buf)]);
const outDir = path.resolve(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(outDir, 'icon.png'), pngs[5].buf);
console.log('icon.ico written:', ico.length, 'B, sizes:', sizes.join(','));
