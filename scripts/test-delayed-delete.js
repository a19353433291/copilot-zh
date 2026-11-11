// 验证延迟删除脚本的路径转义正确性
const { scheduleDeleteAfterExit } = require('../src/core/delayedDelete');
const fs = require('fs');
const os = require('os');
const path = require('path');

const d = path.join(os.tmpdir(), 'copilot-zh-t2');
fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, 'x.txt'), 'x');

const r = scheduleDeleteAfterExit({ dirs: [d], waitMs: 800, maxWaitSec: 10 });
console.log('脚本路径:', r.scriptPath);

const content = fs.readFileSync(r.scriptPath, 'utf8');
const lines = content.split(/\r?\n/);
const targetLine = lines.find(l => l.includes('TARGET='));
console.log('TARGET 行:', targetLine);
console.log('是否含双反斜杠（应为 false）:', targetLine.includes('\\\\'));

// 展示完整脚本便于检查
console.log('\n=== 脚本内容 ===');
lines.slice(0, 30).forEach((l, i) => console.log(String(i + 1).padStart(2) + ': ' + l));
