#!/usr/bin/env node
/**
 * bump_version.js — keep the displayed version in sync with manifest.versionName
 * and (optionally) advance the version before a release.
 *
 * The About page used to hardcode `版本 1.0` / `Version 1.0`, so it never
 * reflected the real version. This tool is the single source of truth: it
 * rewrites both the manifest and the About page text in one atomic, idempotent
 * pass across all six device/language trees.
 *
 * Usage:
 *   node tools/bump_version.js                  # code +1, name patch +1
 *   node tools/bump_version.js --name 1.2.0     # set versionName, leave code
 *   node tools/bump_version.js --code auto       # code = current + 1, name as-is
 *   node tools/bump_version.js --name 1.2.0 --code 102
 *
 * About page shows major.minor (e.g. "1.2") to match the original "1.0" style.
 *
 * Idempotent: a no-op when the file already matches; writes are byte-stable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TREES = [
  'devices/xiaomi-band-9/source/chinese',
  'devices/xiaomi-band-9/source/english',
  'devices/xiaomi-band-9-pro/source/chinese',
  'devices/xiaomi-band-9-pro/source/english',
  'devices/xiaomi-band-10/source/chinese',
  'devices/xiaomi-band-10/source/english',
];

function parseArgs(argv) {
  const out = { name: undefined, code: undefined };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--name') out.name = argv[++i];
    else if (argv[i] === '--code') out.code = argv[++i];
  }
  return out;
}

// Read versionName/versionCode from one manifest to learn the current values.
function readCurrent(manifestPath) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { name: m.versionName, code: m.versionCode };
}

function bumpName(name) {
  // "1.0.0" -> "1.0.1"; if it doesn't parse, keep as-is.
  const parts = String(name).split('.');
  if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) return name;
  parts[2] = String(parseInt(parts[2], 10) + 1);
  return parts.join('.');
}

function updateAbout(uxPath, name) {
  const major = String(name).split('.')[0] || '1';
  const minor = String(name).split('.')[1] || '0';
  const label = `${major}.${minor}`;
  let s = fs.readFileSync(uxPath, 'utf8');
  const next = s.replace(
    /(<text class="version">)[^<]*(<\/text>)/g,
    (_m, open, close) => {
      // Preserve language by re-deriving from the surrounding template is
      // impossible here, so match on the existing prefix word.
      if (/版本/.test(s) && open + close && s.indexOf('版本') !== -1) {
        return open + '版本 ' + label + close;
      }
      return open + 'Version ' + label + close;
    }
  );
  return next;
}

function main() {
  const args = parseArgs(process.argv);
  const refManifest = path.join(ROOT, TREES[0], 'src/manifest.json');
  if (!fs.existsSync(refManifest)) {
    console.error('no manifest at ' + refManifest);
    process.exit(1);
  }
  let cur = readCurrent(refManifest);

  let newName = cur.name;
  let newCode = cur.code;
  if (args.name) newName = args.name;
  else if (args.code === undefined) newName = bumpName(cur.name); // default: bump patch

  if (args.code === 'auto') newCode = cur.code + 1;
  else if (args.code !== undefined) newCode = parseInt(args.code, 10);
  else newCode = cur.code + 1; // default: code +1

  let changed = 0;
  for (const t of TREES) {
    const manifestPath = path.join(ROOT, t, 'src/manifest.json');
    const uxPath = path.join(ROOT, t, 'src/pages/about/about.ux');
    if (!fs.existsSync(manifestPath)) continue;

    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const major = String(newName).split('.')[0] || '1';
    const minor = String(newName).split('.')[1] || '0';
    const label = `${major}.${minor}`;

    if (m.versionName !== newName || m.versionCode !== newCode) {
      m.versionName = newName;
      m.versionCode = newCode;
      fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
      changed++;
    }

    if (fs.existsSync(uxPath)) {
      let s = fs.readFileSync(uxPath, 'utf8');
      const isZh = /版本/.test(s);
      const re = /(<text class="version">)[^<]*(<\/text>)/;
      const wanted = isZh ? `版本 ${label}` : `Version ${label}`;
      if (re.test(s)) {
        const updated = s.replace(re, `$1${wanted}$2`);
        if (updated !== s) {
          fs.writeFileSync(uxPath, updated);
          changed++;
        }
      }
    }
  }

  console.log(
    `VERSION ${cur.name} (code ${cur.code}) -> ${newName} (code ${newCode})` +
      (changed ? `  [updated ${changed} file(s)]` : '  [already current]')
  );
}

main();
