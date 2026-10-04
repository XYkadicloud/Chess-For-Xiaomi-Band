#!/usr/bin/env node
/**
 * update_copy_ai.js — refresh user-facing copy now that an AI opponent exists.
 *
 *  - index subtitle: REMOVED (the user asked for the line under the game name
 *    to be gone). The element and its now-unused style rule are dropped.
 *  - about page: add a line describing the built-in engine
 *  - about page: add a credits line for the cburnett piece set (GPLv2+ needs
 *    the attribution to travel with the artwork)
 *
 * Text is matched exactly per language so the rewrite is deterministic.
 *
 * Every injection is ASSERTED INDIVIDUALLY. A plain `if (src !== before)` check
 * is not enough: the index rewrite and the about rewrite touch different files,
 * but within a single file one regex can silently miss while another succeeds,
 * and the file-level diff hides it. Each step below therefore re-reads and
 * checks for its own expected marker before counting itself as done.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const D = ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10'];
const L = ['chinese'];

let n = 0;

/** Apply `fn` to a file, then assert `check` holds on the result. */
function edit(file, label, fn, check) {
  if (!fs.existsSync(file)) return;
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) {
    if (!check(before)) throw new Error(label + ': no change made AND assertion fails (regex missed)');
    return;                                   // already applied, idempotent
  }
  if (!check(after)) throw new Error(label + ': edit applied but assertion fails');
  fs.writeFileSync(file, after, 'utf8');
  n++;
  console.log('  OK   ' + label);
}

for (const d of D) {
  for (const l of L) {
    const dir = path.join(ROOT, 'devices', d, 'source', l, 'src', 'pages');

    /* --- index: remove the subtitle line under the game name ------- */
    edit(
      path.join(dir, 'index', 'index.ux'),
      d + '/' + l + '/index (subtitle removed)',
      (s) => {
        s = s.replace(/\s*<text class="subtitle">[^<]*<\/text>/, '');
        s = s.replace(/\s*\.subtitle\s*\{[^}]*\}/, '');
        if (!/\.title\s*\{[^}]*margin-bottom/.test(s)) {
          s = s.replace(/\.title\s*\{([^}]*)\}/, (m, body) =>
            '.title {' + body.replace(/;?\s*$/, ';') + ' margin-bottom:34dp; }');
        }
        return s;
      },
      (s) => !s.includes('class="subtitle"') &&
             !/\.subtitle\s*\{/.test(s) &&
             /\.title\s*\{[^}]*margin-bottom/.test(s)
    );

    /* --- about: describe the engine ------------------------------- */
    // NOTE the explicit `includes` guards. Without them the replacement regex
    // (which happily matches text that ALREADY contains the sentence) appends
    // the same sentence again on every run -- a non-idempotent edit that only
    // shows up as an ever-growing bodyText.
    edit(
      path.join(dir, 'about', 'about.ux'),
      d + '/' + l + '/about (engine)',
      (s) => {
        if (l === 'chinese') {
          if (s.includes('内置 AI 引擎')) return s;
          return s.replace(
            /(<text class="bodyText">)(Chess 是一款[^<]*?)(<\/text>)/,
            '$1$2 内置 AI 引擎，可在没有第二位玩家时与电脑对弈。$3');
        }
        if (s.includes('built-in AI engine')) return s;
        return s.replace(
          /(<text class="bodyText">)(Chess is an offline[^<]*?)(<\/text>)/,
          '$1$2 A built-in AI engine lets you play against the computer when no second player is available.$3');
      },
      (s) => s.includes(l === 'chinese' ? '内置 AI 引擎' : 'built-in AI engine') &&
             // Guard against the duplication bug specifically: the sentence
             // must appear exactly once.
             s.split(l === 'chinese' ? '内置 AI 引擎' : 'built-in AI engine').length === 2
    );

    /* --- about: credit the piece artwork -------------------------- */
    // cburnett is GPLv2+; the attribution has to stay with the artwork.
    edit(
      path.join(dir, 'about', 'about.ux'),
      d + '/' + l + '/about (piece credits)',
      (s) => {
        // `includes` is case-sensitive, and the card text says "Colin", so the
        // marker must be matched case-insensitively or this duplicates the card
        // on every run.
        if (/cburnett/i.test(s)) return s;                // idempotent
        const item = l === 'chinese'
          ? '\n      <list-item class="infoItem creditsItem" type="item">\n' +
            '        <text class="sectionTitle">棋子素材</text>\n' +
            '        <text class="bodyText">棋子外观来自 lichess 默认棋子集 cburnett，作者 Colin M.L. Burnett，以 GPLv2+ 许可使用。</text>\n' +
            '      </list-item>'
          : '\n      <list-item class="infoItem creditsItem" type="item">\n' +
            '        <text class="sectionTitle">Piece artwork</text>\n' +
            '        <text class="bodyText">Pieces use the cburnett set, the default on lichess.org. Art by Colin M.L. Burnett, used under GPLv2+.</text>\n' +
            '      </list-item>';
        // Insert right before the support (爱发电) item so it sits with the
        // other info cards rather than after the donation block.
        s = s.replace(
          /(\s*)<list-item class="supportItem"/,
          item + '$1<list-item class="supportItem"');
        // A two-line credits card is much shorter than the generic .infoItem,
        // so give it its own height or it inherits min-height:165dp and leaves
        // a big empty gap in the list.
        if (!/\.creditsItem\s*\{/.test(s)) {
          s = s.replace(/(\s*)\.infoItem\s*\{/,
            '$1.creditsItem { height:104dp; }$1.infoItem {');
        }
        return s;
      },
      (s) => /cburnett/i.test(s) && /Colin M\.?\s*L\.?\s*Burnett/.test(s) &&
             // exactly one credits CARD, so a re-run cannot silently add a second.
             // (Count the card elements only -- the style rule also mentions
             // ".creditsItem", which would otherwise make this 2.)
             (s.match(/class="infoItem creditsItem"/g) || []).length === 1 &&
             /\.creditsItem\s*\{/.test(s)
    );
  }
}
console.log('\ndone, ' + n + ' copy updates applied');
