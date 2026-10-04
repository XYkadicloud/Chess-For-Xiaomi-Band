#!/usr/bin/env node
/*
 * package_rpk.js — copy every built RPK into releases/ under a name that says
 * which band and which language it is for.
 *
 * The toolkit always names the output "<package>.<mode>.<versionName>.rpk"
 * (e.g. com.xykadi.chess.debug.1.0.0.rpk), and all six trees share the same
 * package id -- so the raw build output is unidentifiable once copied out of
 * its dist/ folder.
 *
 * We deliberately do NOT change manifest.json's "package" field: that is the
 * app identity on the device. Changing it would make the new build install
 * alongside (not over) the existing app and break updates/signing. Renaming
 * the delivered file is the safe fix.
 *
 * Written in Node (not bash) so UTF-8 filenames survive on Windows.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'releases');

const DEVICES = [
  { dir: 'xiaomi-band-9', label: 'Band9' },
  { dir: 'xiaomi-band-9-pro', label: 'Band9Pro' },
  { dir: 'xiaomi-band-10', label: 'Band10' }
];
// One tree per device: Chinese and English now live in the same package and are
// selected at runtime, so the language is no longer part of the file name.
const LANGS = [
  { dir: 'chinese', label: '' }
];

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

fs.mkdirSync(OUT, { recursive: true });

const made = [];
const missing = [];

for (const d of DEVICES) {
  for (const l of LANGS) {
    const tree = path.join(ROOT, 'devices', d.dir, 'source', l.dir);
    const distDir = path.join(tree, 'dist');
    if (!fs.existsSync(distDir)) { missing.push(`${d.dir}/${l.dir} (no dist)`); continue; }

    const all = fs.readdirSync(distDir).filter(f => f.endsWith('.rpk'));
    if (!all.length) { missing.push(`${d.dir}/${l.dir} (no .rpk)`); continue; }
    // Prefer a release-signed build; fall back to debug only if that is all
    // there is. dist/ can hold both at once.
    const rpk = all.find(f => f.includes('.release.')) || all.sort().pop();

    const manifest = readJson(path.join(tree, 'src', 'manifest.json')) || {};
    const version = manifest.versionName || '1.0.0';
    // ".debug." in the toolkit's own name marks a debug-signed build
    const mode = /\.debug\./.test(rpk) ? 'debug' : (/release/i.test(rpk) ? 'release' : 'signed');

    const target = `Chess_${d.label}_v${version}_${mode}.rpk`;
    const dest = path.join(OUT, target);
    fs.copyFileSync(path.join(distDir, rpk), dest);
    const kb = (fs.statSync(dest).size / 1024).toFixed(1);
    made.push({ target, kb, src: `${d.dir}/${l.dir}` });
  }
}

// A short index so the folder is self-explanatory.
const lines = [
  '# 安装包目录（releases/）',
  '',
  '文件名格式：`Chess_<设备>_v<版本>_<签名>.rpk`',
  '',
  '| 文件 | 设备 | 大小 |',
  '|---|---|---|'
];
for (const m of made) {
  const dev = m.target.split('_')[1];
  lines.push(`| ${m.target} | ${dev} | ${m.kb} KB |`);
}
lines.push('');
lines.push('说明：');
lines.push('');
lines.push('- 本目录由 `tools/package_rpk.js` 生成，重新构建后再次运行即刷新。');
lines.push('- **每个设备只有一个包**，中英文已合并：首次启动跟随设备语言，');
lines.push('  用户也可以在「设置 → 语言」里手动切换（跟随系统 / 中文 / English）。');
lines.push('- 所有构建共用同一个包名 `com.xykadi.chess`，只有**文件名**不同；');
lines.push('  这是有意为之——改 manifest 的 `package` 会让手环把新包当成另一个应用，');
lines.push('  无法覆盖升级，也会影响签名与调试。');
lines.push('- `_debug` 表示调试签名包，仅用于本地安装测试；正式分发需要 release 签名。');
lines.push('');
fs.writeFileSync(path.join(OUT, 'README.md'), lines.join('\n'), 'utf8');

console.log('releases/ 已生成：\n');
for (const m of made) console.log(`  ${m.target}   (${m.kb} KB)   <- ${m.src}`);
if (missing.length) {
  console.log('\n未找到构建产物：');
  for (const m of missing) console.log('  ' + m);
}
console.log(`\n共 ${made.length} 个安装包 -> ${OUT}`);
process.exit(made.length === DEVICES.length ? 0 : 1);
