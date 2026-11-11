// 从 github.exe 内嵌资源中提取真实 UI 文案候选，供人工/后续翻译使用。
//
// 原理：Copilot 的界面是 Vite 构建的 React 应用，资源以 brotli 压缩嵌在 exe 里。
// 解压后扫描字符串字面量，用启发式规则筛掉库内部噪声，得到「可能是界面文案」的清单。
//
// 用法：
//   node scripts/extract-strings.js                    # 扫描并输出清单
//   node scripts/extract-strings.js --exe "路径"        # 指定 exe
//   node scripts/extract-strings.js --out strings.json # 指定输出

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function parseArgs(argv) {
  const a = { exe: null, out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--exe') a.exe = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
  }
  return a;
}

/** 这些 bundle 是第三方库，其字符串基本不是产品 UI */
const LIB_BUNDLE = /vendor-|monaco|shiki|mermaid|elk|katex|tree-sitter|univer|dompurify|codemirror|prism|highlight|worker|wasm|emmet|lang-|theme-/i;

/** 明确的非 UI 文案特征 */
function looksLikeNoise(t) {
  // 代码片段
  if (/[{}<>;=]|=>|\bfunction\b|\breturn\b|\[\]|\$\(/i.test(t)) return true;
  // 路径 / URL / 文件名
  if (/^https?:|^\/|^[a-z]:\\|\.(js|css|png|svg|json|woff2?|ttf|wasm|map)$/i.test(t)) return true;
  // CSS 值
  if (/^\d+(\.\d+)?(px|em|rem|%|vh|vw|deg|s|ms)$/i.test(t)) return true;
  if (/^(rgb|rgba|hsl|var|calc)\(/i.test(t)) return true;
  // 字体列表
  if (/,/.test(t) && /sans-serif|serif|monospace|Helvetica|Arial|Consolas/i.test(t)) return true;
  // 常量 / 枚举
  if (/^[A-Z][A-Z0-9_]{3,}$/.test(t)) return true;
  // 单个字符或纯符号
  if (t.length < 3 || !/[A-Za-z]/.test(t)) return true;
  // HTML/CSS 属性值
  if (/^(aria|data|role)-|^(true|false|null|undefined)$/i.test(t)) return true;
  // 正则 / 正则片段
  if (/\\[dswbSWB]|\[\^|\(\?:/.test(t)) return true;
  // 很长的是日志/文档，不是 UI
  if (t.length > 160) return true;
  // 纯小写标识符（多为内部 key）
  if (/^[a-z][a-zA-Z0-9_-]*$/.test(t) && t.length < 20) return true;
  // MIME / 编码
  if (/^(application|text|image|audio|video)\//i.test(t)) return true;
  // 版本/哈希
  if (/^[0-9a-f]{8,}$/i.test(t)) return true;
  return false;
}

/** 看起来像 UI 文案的特征加分 */
function looksLikeUI(t) {
  const s = t.trim();
  if (!s) return false;
  // 首字母大写
  if (!/^[A-Z]/.test(s)) return false;
  // 至少含一个小写字母（排除缩写）
  if (!/[a-z]/.test(s)) return false;
  return true;
}

function readWhole(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.allocUnsafe(size);
    let read = 0;
    while (read < size) {
      const n = fs.readSync(fd, buf, read, Math.min(256 * 1024 * 1024, size - read), read);
      if (n <= 0) break;
      read += n;
    }
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

/** 在二进制中定位 /assets/xxx.js 并尝试 brotli 解压 */
function extractBundles(buf) {
  const marker = Buffer.from('/assets/', 'utf8');
  const seen = new Set();
  const out = [];
  let idx = 0;
  while ((idx = buf.indexOf(marker, idx)) !== -1) {
    let end = idx;
    while (end < buf.length && end - idx < 200) {
      const c = buf[end];
      if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
          c === 47 || c === 45 || c === 95 || c === 46) end++;
      else break;
    }
    const name = buf.subarray(idx, end).toString('utf8');
    if (name.endsWith('.js') && !seen.has(name)) {
      seen.add(name);
      for (let delta = 0; delta <= 6; delta++) {
        const start = end + delta;
        if (start >= buf.length) break;
        const len = Math.min(24 * 1024 * 1024, buf.length - start);
        try {
          const text = zlib.brotliDecompressSync(buf.subarray(start, start + len)).toString('utf8');
          out.push({ name, text });
          break;
        } catch (e) { /* 继续尝试下一个偏移 */ }
      }
    }
    idx += 1;
  }
  return out;
}

/** 从 JS 源码中提取字符串字面量 */
function extractLiterals(src) {
  const found = [];
  const re = /`([^`\\$]{2,200})`|"([^"\\\n]{2,200})"|'([^'\\\n]{2,200})'/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const s = m[1] || m[2] || m[3];
    if (s) found.push(s);
  }
  return found;
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, '..');

  let exePath = args.exe;
  if (!exePath) {
    const { locateApp } = require(path.join(root, 'src', 'core', 'locator'));
    const loc = locateApp();
    if (!loc.ok) {
      console.error('未找到 GitHub Copilot，请用 --exe 指定路径');
      process.exit(1);
    }
    exePath = loc.exePath;
  }

  console.log('目标:', exePath);
  console.log('读取文件…');
  const buf = readWhole(exePath);
  console.log(`  ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

  console.log('定位并解压前端资源…');
  const bundles = extractBundles(buf);
  console.log(`  解出 ${bundles.length} 个 bundle`);

  const counter = new Map();
  let libSkipped = 0;
  for (const b of bundles) {
    if (LIB_BUNDLE.test(b.name)) { libSkipped++; continue; }
    for (const lit of extractLiterals(b.text)) {
      const t = lit.trim();
      if (!looksLikeUI(t)) continue;
      if (looksLikeNoise(t)) continue;
      counter.set(t, (counter.get(t) || 0) + 1);
    }
  }
  console.log(`  跳过库 bundle ${libSkipped} 个`);
  console.log(`  候选文案 ${counter.size} 条`);

  const list = [...counter.entries()]
    .map(([en, n]) => ({ en, n }))
    .sort((a, b) => b.n - a.n || a.en.length - b.en.length);

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(root, 'dist-packs', 'strings-candidates.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: list.length, strings: list }, null, 1));

  console.log('\n已写入:', outPath);
  console.log('\n出现频率最高的 40 条（最可能是界面文案）：');
  list.slice(0, 40).forEach((x, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. [${String(x.n).padStart(3)}x] ${x.en.slice(0, 78)}`);
  });
}

main();
