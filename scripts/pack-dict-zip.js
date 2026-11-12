// 把字典包打包成可上传到 Release 的 zip。
//
// 用法：node scripts/pack-dict-zip.js
// 输出：dist-packs/packs-zh-CN-<version>.zip
//
// 为什么用 zip 而不是直接传目录：
//   Release 只能上传单个文件，目录需要打包。
//   安装端解压后仍需通过 Ed25519 验签，所以 zip 本身不需要额外签名。

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const SRC = path.join(root, 'bundled-packs');
const OUT_DIR = path.join(root, 'dist-packs');

// 读取 manifest 拿版本号
const manifestPath = path.join(SRC, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('找不到 bundled-packs/manifest.json');
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = manifest.manifest.packVersion;

const files = fs.readdirSync(SRC).filter(f => {
  const st = fs.statSync(path.join(SRC, f));
  return st.isFile();
});

console.log('打包字典包');
console.log('  来源:', SRC);
console.log('  版本:', version);
console.log('  文件:', files.join(', '));

/**
 * 手写一个最小 ZIP（store 模式，不压缩）。
 * 字典包本身已经是压缩过的小文件（~100KB），
 * 再压缩收益有限，反而增加复杂度与依赖。
 */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const crc = crc32(data);

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // flags: UTF-8
    local.writeUInt16LE(0, 8);             // method: store
    local.writeUInt16LE(0, 10);            // time
    local.writeUInt16LE(0, 12);            // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // compressed size
    local.writeUInt32LE(data.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len

    localParts.push(local, nameBuf, data);

    // Central directory header
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0x0800, 8);      // flags
    central.writeUInt16LE(0, 10);          // method
    central.writeUInt16LE(0, 12);          // time
    central.writeUInt16LE(0, 14);          // date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk start
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);     // local header offset

    centralParts.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const localBuf = Buffer.concat(localParts);

  // End of central directory
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, end]);
}

const entries = files.map(f => ({
  name: f,
  data: fs.readFileSync(path.join(SRC, f)),
}));

const zip = buildZip(entries);

fs.mkdirSync(OUT_DIR, { recursive: true });
const outName = `packs-zh-CN-${version}.zip`;
const outPath = path.join(OUT_DIR, outName);
fs.writeFileSync(outPath, zip);

console.log('');
console.log('已生成:', outPath);
console.log('  大小:', (zip.length / 1024).toFixed(1), 'KB');
console.log('');
console.log('上传步骤：');
console.log('  1. 在同一个 Release 下，把此 zip 作为额外附件上传');
console.log('  2. 文件名必须匹配 packs-zh-CN-<版本>.zip');
console.log('  3. 应用内「字典包 → 检查更新」会自动发现它');
