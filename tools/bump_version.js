#!/usr/bin/env node
/**
 * bump_version.js — keep the displayed version in sync with manifest.versionName
 * and (optionally) advance the version before a release.
 *
 * The About page used to hardcode `版本 1.0` / `Version 1.0`, so it never
 * reflected the real version. This tool is the single source of truth: it
 * rewrites the manifest, and the version label is now supplied by i18n
 * (src/i18n/*.json `about.version`) rather than being baked into the template.
 *
 * After the language merge each device keeps ONE tree (source/chinese), so the
 * rewrite is a 3-tree pass, idempotent and byte-stable.
 *
 * Usage:
 *   node tools/bump_version.js                  # code +1, name patch +1
 *   node tools/bump_version.js --name 1.2.0     # set versionName, leave code
 *   node tools/bump_version.js --code auto       # code = current + 1, name as-is
 *   node tools/bump_version.js --name 1.2.0 --code 102
 *
 * Idempotent: a no-op when the file already matches; writes are byte-stable.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TREES = [
  'devices/xiaomi-band-9/source/chinese',
  'devices/xiaomi-band-9-pro/source/chinese',
  'devices/xiaomi-band-10/source/chinese',
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

/*
 * The version label is no longer written into about.ux — the template binds
 * `{{versionText}}` and the page composes it from the i18n `about.version`
 * key. Keeping the number out of the template means one place to change and no
 * language-specific branches.
 *
 * scripts/update must keep this in sync with tools/build_i18n.js, which owns
 * the string table. The version key is special-cased here because it is the
 * only string derived from the manifest rather than hand-written.
 */
function updateI18nVersion(file, label) {
  if (!fs.existsSync(file)) return false;
  let s = fs.readFileSync(file, 'utf8');
  const re = /("version"\s*:\s*")[^"]*(")/;
  if (!re.test(s)) return false;
  const next = s.replace(re, '$1' + label + '$2');
  if (next !== s) { fs.writeFileSync(file, next); return true; }
  return false;
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

  const label = `${String(newName).split('.')[0] || '1'}.${String(newName).split('.')[1] || '0'}`;

  let changed = 0;
  for (const t of TREES) {
    const manifestPath = path.join(ROOT, t, 'src/manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (m.versionName !== newName || m.versionCode !== newCode) {
      m.versionName = newName;
      m.versionCode = newCode;
      fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
      changed++;
    }

    /* The canonical i18n files at the repo root plus the per-device copies. */
    const i18nTargets = [
      `src/i18n/zh-CN.json`,
      `src/i18n/en-US.json`,
      `src/i18n/defaults.json`,
      `${t}/src/i18n/zh-CN.json`,
      `${t}/src/i18n/en-US.json`,
      `${t}/src/i18n/defaults.json`
    ];
    for (const rel of i18nTargets) {
      if (updateI18nVersion(path.join(ROOT, rel), label)) changed++;
    }
  }

  console.log(
    `VERSION ${cur.name} (code ${cur.code}) -> ${newName} (code ${newCode})` +
      (changed ? `  [updated ${changed} file(s)]` : '  [already current]')
  );
}

main();
