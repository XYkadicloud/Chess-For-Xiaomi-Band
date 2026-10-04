#!/usr/bin/env node
/*
 * add_end_game_menu.js
 * ---------------------------------------------------------------------------
 * 在"棋局菜单"里：
 *   1. 删除「新建棋局 / New game」项；
 *   2. 在它原来的位置放上「结束对局 / End game」。
 *
 * 「结束对局」= 一步到位收尾：停钟 -> 标记终局 -> 立刻回到首页。
 * 不需要再「认输」然后再「退出对局」两步。
 *
 * 为什么用工具脚本而不是手改 6 份产物：
 *   - 6 套工程（3 设备 × 2 语言）必须完全一致；
 *   - 必须幂等，apply_all.sh 反复跑不能叠加；
 *   - 每个注入点单独断言，任一处失配立即报错（不要让其他处的成功掩盖它）。
 *
 * 注意：game.ux 的 <script> 常被压缩成一整行，正则里绝不能用 \n 定位。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const TREES = [];
for (const dev of ['xiaomi-band-9', 'xiaomi-band-9-pro', 'xiaomi-band-10']) {
  for (const lang of ['chinese']) {
    TREES.push({ dev, lang });
  }
}

const COPY = {
  chinese: {
    newGameItem: '<text class="menuItem" @click="newGame">新建棋局</text>',
    endGameLabel: '结束对局',
    endTitle: '对局结束',
    endHint: '对局已结束',
  },
  english: {
    newGameItem: '<text class="menuItem" @click="newGame">New game</text>',
    endGameLabel: 'End game',
    endTitle: 'Game over',
    endHint: 'Game ended',
  },
};

function count(hay, needle) {
  return hay.split(needle).length - 1;
}

function edit(file, label, fn) {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) {
    throw new Error('[' + label + '] produced no change -> guard/regex missed: ' + file);
  }
  fs.writeFileSync(file, after);
}

let errors = 0;

for (const t of TREES) {
  const file = path.join(ROOT, 'devices', t.dev, 'source', t.lang, 'src', 'pages', 'game', 'game.ux');
  const c = COPY[t.lang];
  const tag = t.dev + '/' + t.lang;

  try {
    if (!fs.existsSync(file)) throw new Error('game.ux not found: ' + file);
    let src = fs.readFileSync(file, 'utf8');

    /* ------------------------------------------------------------------
     * 注入点 1：菜单项 —— 删「新建棋局」，原位放「结束对局」
     * ------------------------------------------------------------------ */
    const hasOldItem = src.includes(c.newGameItem);
    const hasNewItem = src.includes('@click="endGame">' + c.endGameLabel + '</text>');

    if (hasOldItem) {
      // 精确替换那一整行（该项独占一行）
      const re = new RegExp('^([ \\t]*)' + c.newGameItem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ \\t]*$', 'm');
      if (!re.test(src)) throw new Error('menu item found but not anchored on its own line');
      src = src.replace(re, '$1<text class="menuItem" @click="endGame">' + c.endGameLabel + '</text>');
      if (src.includes(c.newGameItem)) throw new Error('old "new game" item still present after replace');
      if (!src.includes('@click="endGame">' + c.endGameLabel + '</text>')) {
        throw new Error('endGame menu item not inserted');
      }
    } else if (!hasNewItem) {
      throw new Error('neither old "' + c.newGameItem + '" nor new endGame item found');
    }
    // 走到这里：要么刚替换成功，要么本来就是新版（幂等）

    const itemCount = count(src, '@click="endGame">' + c.endGameLabel + '</text>');
    if (itemCount !== 1) throw new Error('endGame item appears ' + itemCount + ' times (expected 1)');

    /* ------------------------------------------------------------------
     * 注入点 2：endGame 方法 —— 插在 exitGame 之前
     *   行为与既有终局（finishByTimeout）一致：置终局、写结果、清存档、停钟。
     *   额外做 closeMenu()，因为这一步是从菜单里点的。
     * ------------------------------------------------------------------ */
    if (!/endGame\s*\(\s*\)\s*\{/.test(src)) {
      const anchor = 'exitGame(){';
      if (!src.includes(anchor)) throw new Error('exitGame() anchor not found');
      const method =
        'endGame(){' +
          // 已经终局就不要覆盖已有结果（如将死/超时）
          'if(this.resultVisible||this.gameOver)return;' +
          'this.gameOver=true;' +
          "this.resultTitle='" + c.endTitle + "';" +
          "this.hintText='" + c.endHint + "';" +
          'this.clearActiveGame();' +
          'this.stopClock();' +
          'this.closeMenu();' +
        '},';
      src = src.replace(anchor, method + anchor);
      if (!/endGame\s*\(\s*\)\s*\{/.test(src)) throw new Error('endGame method not inserted');
    }

    /* ------------------------------------------------------------------
     * 注入点 3：棋盘尺寸跟随视口 —— 结构在 div 板上，改写 style 绑定
     *   left/top 交给 onAreaChange 动态居中，避免外层静态样式与内联样式打架。
     * ------------------------------------------------------------------ */
    const boardRe = /<div class="board" style="([^"]*)">/;
    const m = src.match(boardRe);
    if (!m) throw new Error('board container not found');
    if (m[1] !== 'width:{{boardSize}}dp;height:{{boardSize}}dp;left:{{boardLeft}}dp;top:{{boardTop}}dp;') {
      throw new Error('board container has unexpected style: ' + m[1]);
    }
    // 当前无需改动（保留锚点，供后续调整）；确认存在即可
    // （布局自适应由 onAreaChange -> fitBoardToViewport 处理）

    /* ------------------------------------------------------------------
     * 断言：模板里 @click 调用的方法必须都在 script 里定义
     *   （这类缺失在真机上是"点了没反应"，最难发现）
     * ------------------------------------------------------------------ */
    const calls = new Set();
    const callRe = /@(?:click|touchend|touchstart)="([A-Za-z_$][\w$]*)\(?/g;
    let mm;
    while ((mm = callRe.exec(src)) !== null) calls.add(mm[1]);

    const missing = [];
    for (const fn of calls) {
      // 方法可以有参数，如 onTouchStart(e) / tapSquare(i)，所以不能强制空括号
      const defRe = new RegExp('(?:^|[,\\{;\\s])' + fn + '\\s*\\([^)]*\\)\\s*\\{');
      if (!defRe.test(src)) missing.push(fn);
    }
    if (missing.length) throw new Error('handlers referenced in template but not defined: ' + missing.join(', '));

    if (src === fs.readFileSync(file, 'utf8')) {
      console.log('OK    ' + tag + '  (already up to date)');
    } else {
      fs.writeFileSync(file, src);
      console.log('OK    ' + tag + '  (end-game menu applied, ' + calls.size + ' handlers verified)');
    }
  } catch (e) {
    console.log('FAIL  ' + tag + '  ' + e.message);
    errors++;
  }
}

console.log('---');
if (errors) {
  console.log('ADD-END-GAME FAILED (' + errors + ' tree(s))');
  process.exit(1);
}
console.log('ADD-END-GAME OK (6 trees: new-game removed, end-game added)');
