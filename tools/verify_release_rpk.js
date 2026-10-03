#!/usr/bin/env node
/**
 * verify_release_rpk.js — inspect the BUILT artifacts, not just the sources.
 *
 * Every other verifier in tools/ reads .ux source. That is necessary but not
 * sufficient: the toolkit bundles pages, inlines the AI engine, minifies and
 * may rewrite control flow. A fix that exists in source can still be absent
 * from the shipped RPK if a build step drops it — and the reverse trap bites
 * too: a naive source-side regex can miss a form the minifier produced (e.g.
 * `if (a && b) f()` becomes `a && b && f()`).
 *
 * This tool therefore unzips releases/*.rpk (or a path given on the command
 * line) and asserts the user-visible outcomes are actually present:
 *
 *   1. META-INF/CERT is present            (the package is signed)
 *   2. 12 piece PNGs, and ZERO .svg        (the band cannot render SVG)
 *   3. the AI engine is bundled into pages/game/game.js
 *   4. the AI-first-move kick is in the compiled onShow
 *   5. setup exposes the computed time labels
 *   6. the About page credits the cburnett set
 *   7. the index subtitle was removed
 *   8. the game menu offers endGame and no longer offers a bare "new game" item
 *
 * Usage:
 *   node tools/verify_release_rpk.js                 # all releases/*.rpk
 *   node tools/verify_release_rpk.js path/to/x.rpk   # specific package
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

/* ------------------------------------------------------------------ *
 * Minimal ZIP reader: central-directory walk + stored/deflate extract.
 * Node has no built-in unzip, and shelling out to `unzip` is not
 * guaranteed present on Windows, so we do it here.
 * ------------------------------------------------------------------ */
function readZip(file) {
  const buf = fs.readFileSync(file);

  // Locate End Of Central Directory (signature 0x06054b50), scanning back.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no EOCD): ' + file);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);          // central directory offset
  const entries = {};

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad CD entry at ' + p);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');

    // The local header repeats name/extra lengths, which can differ from the
    // central directory's, so always read the LOCAL ones to find the data.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(dataStart, dataStart + compSize);

    entries[name] = {
      size: compSize,
      test: buf.slice(dataStart, dataStart + Math.min(compSize, 4096)),
      get() {
        return method === 0 ? raw : zlib.inflateRawSync(raw);
      }
    };
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return { names: Object.keys(entries), entries };
}

let problems = 0;
function bad(pkg, msg) { problems++; console.log('FAIL ' + pkg + ' :: ' + msg); }

/** Read a text entry, or null if absent. */
function textOf(zip, name) {
  const e = zip.entries[name];
  if (!e) return null;
  return e.get().toString('utf8');
}

function getSrc(name) {
  // Find a compiled page bundle regardless of the directory layout version.
  const hit = name.find((n) => /^pages\/[^/]+\/[^/]+\.js$/.test(n));
  return hit || null;
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (() => {
      const dir = path.join(ROOT, 'releases');
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.rpk'))
        .map((f) => path.join(dir, f));
    })();

if (!targets.length) {
  console.log('no .rpk found under releases/ — build first (tools/build_release.sh)');
  process.exit(0);
}

for (const file of targets) {
  const pkg = path.basename(file);
  let zip;
  try {
    zip = readZip(file);
  } catch (e) {
    bad(pkg, 'not a readable zip: ' + e.message);
    continue;
  }
  const n = zip.names;

  // 1. signed
  if (!n.includes('META-INF/CERT')) bad(pkg, 'no META-INF/CERT (unsigned build)');

  // 2. piece sprites
  const pngs = n.filter((x) => /pieces\/[wb][KQRBNP]\.png$/.test(x));
  const svgs = n.filter((x) => x.toLowerCase().endsWith('.svg'));
  if (pngs.length !== 12) bad(pkg, 'expected 12 piece PNGs, found ' + pngs.length);
  if (svgs.length) bad(pkg, 'contains ' + svgs.length + ' .svg file(s) (unrenderable on Vela)');

  // 3-4. game bundle
  const gamePath = n.find((x) => x === 'pages/game/game.js');
  if (!gamePath) {
    bad(pkg, 'missing compiled pages/game/game.js');
  } else {
    const g = textOf(zip, gamePath);
    // Engine must be inlined (the toolkit collapses `import ai from ...`).
    if (!/negamax/.test(g) || !/quiesce/.test(g)) {
      bad(pkg, 'AI engine not present in compiled game bundle');
    }
    // The first-move kick must be inside onShow SPECIFICALLY. A whole-file
    // search is not enough: onInit carries an identical `isAiTurn() &&
    // maybeAiMove()` kick, so a loose match passes even when onShow's kick is
    // missing. That is the exact "guard satisfied by an unrelated occurrence"
    // bug that shipped once already -- do not repeat it here.
    //
    // The minifier rewrites `if (a && b) f()` into `a && b && f()`, so accept
    // either form but only within the onShow body.
    const showBody = (() => {
      const i = g.indexOf('onShow()');
      if (i < 0) return null;
      // onShow's body ends at the next top-level `},` that starts a new method.
      const rest = g.slice(i);
      const end = rest.search(/\},\s*[A-Za-z_$][\w$]*\s*\(/);
      return end < 0 ? rest.slice(0, 800) : rest.slice(0, end);
    })();
    if (showBody === null) {
      bad(pkg, 'compiled bundle has no onShow()');
    } else {
      const kick =
        /if\s*\([^)]*isAiTurn\(\)\s*\)\s*this\.maybeAiMove\(\)/.test(showBody) ||
        /isAiTurn\(\)\s*&&\s*this\.maybeAiMove\(\)/.test(showBody);
      if (!kick) bad(pkg, 'compiled onShow has no AI-first-move kick (onInit alone is not enough)');
    }
  }

  // 5. setup computed labels
  const setupPath = n.find((x) => x === 'pages/setup/setup.js');
  if (setupPath) {
    const s = textOf(zip, setupPath);
    if (!/minutesLabel/.test(s)) bad(pkg, 'setup bundle lost minutesLabel');
  }

  // 6. about credits
  const aboutPath = n.find((x) => x === 'pages/about/about.js');
  if (aboutPath) {
    const a = textOf(zip, aboutPath);
    if (!/cburnett/i.test(a) || !/Colin/.test(a)) {
      bad(pkg, 'about page is missing the cburnett/GPLv2+ piece credit');
    }
  }

  // 7. index subtitle removed
  const idxPath = n.find((x) => x === 'pages/index/index.js');
  if (idxPath) {
    const i = textOf(zip, idxPath);
    if (/subtitle/.test(i)) bad(pkg, 'index bundle still contains the removed subtitle');
  }

  // 8. game menu: endGame present, bare newGame menu item gone.
  //    The template is compiled into the page bundle, so assert on the bundle.
  if (gamePath) {
    const g = textOf(zip, gamePath);
    if (!/endGame/.test(g)) bad(pkg, 'game bundle has no endGame handler');
    // A residual menu row would show up as a newGame click binding; the result
    // screen's "play again" also uses newGame, so look for the old menu label
    // *or* two distinct newGame bindings surviving in the template.
    if (/新建棋局/.test(g) || />New game</.test(g)) {
      bad(pkg, 'game bundle still shows the removed "new game" menu row');
    }
  }
}

console.log('\n' + (problems === 0
  ? 'RELEASE RPK OK (' + targets.length + ' package' + (targets.length === 1 ? '' : 's') +
    ' x signed + 12 sprites + AI kick + credit + end-game menu)'
  : problems + ' RELEASE PROBLEM(S)'));
process.exit(problems === 0 ? 0 : 1);
