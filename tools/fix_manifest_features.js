#!/usr/bin/env node
/*
 * fix_manifest_features.js — make sure every device tree's manifest.json
 * declares the platform features its pages actually import.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Vela docs say `@system.configuration` needs no declaration
 * ("接口声明：无需声明"), but aiot-toolkit 2.0.4 hard-fails the build with:
 *
 *     missing feature: [ { "name": "system.configuration" } ]
 *
 * so the declaration is required in practice. The language detection added in
 * the i18n merge imports configuration from four pages per tree, which turned
 * a previously-working build into a hard error. Scanning the imports and
 * syncing the manifest keeps that from silently regressing again.
 *
 * Idempotent: re-running produces a byte-identical manifest.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEVICES = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];

/* Modules that are imported but NOT declared as features — they ship with the
 * runtime and adding them makes the toolkit complain about unknown features. */
const NOT_A_FEATURE = new Set([
  '@system.router',   // declared already, but keep the list explicit
  '@system.app'
]);

/* Map an import specifier to the feature name the manifest expects. */
function featureFor(spec) {
  /* '@system.configuration' -> 'system.configuration' */
  return spec.replace(/^@/, '');
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ux|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

let changed = 0;

for (const d of DEVICES) {
  const src = path.join(ROOT, 'devices', d, 'source', 'chinese', 'src');
  const manifestPath = path.join(src, 'manifest.json');
  if (!fs.existsSync(manifestPath)) { console.log('  SKIP ' + d); continue; }

  const files = walk(src, []);
  const imported = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const re = /(?:import\s+[^'"]*from\s+|require\()\s*'(@system\.[a-zA-Z0-9_.]+)'/g;
    let m;
    while ((m = re.exec(text))) imported.add(m[1]);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.features)) manifest.features = [];

  const have = new Set(manifest.features.map((f) => f.name));
  const need = [...imported]
    .filter((s) => !NOT_A_FEATURE.has(s))
    .map(featureFor)
    .filter((name) => !have.has(name))
    .sort();

  if (!need.length) { console.log('  OK   ' + d + ' (features already complete)'); continue; }

  for (const name of need) {
    manifest.features.push({ name });
    console.log('  ADD  ' + d + ' -> ' + name);
  }
  /* Keep the list sorted so repeated runs converge. */
  manifest.features.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  changed++;
}

console.log('\nmanifest features synced (' + changed + ' manifest(s) rewritten)');
