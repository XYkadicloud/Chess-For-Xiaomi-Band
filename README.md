# Chess for Xiaomi Vela Bands / 小米 Vela 手环国际象棋

Offline chess quick app (`.rpk`) for Xiaomi Vela bands, with a built-in
engine. 运行在 Xiaomi Vela 手环上的离线国际象棋快应用，内置自研引擎。

Package name `com.xykadi.chess` · current release **v1.2.0**.

## Devices / 设备

One source tree per device. 每个设备一套源码。

| Device / 设备 | Screen / 屏幕 | Source |
|---|---:|---|
| Xiaomi Smart Band 9 | 192×490 (192dp) | [`devices/xiaomi-band-9/source/chinese`](devices/xiaomi-band-9/source/chinese) |
| Xiaomi Smart Band 9 Pro | 336×480 (336dp) | [`devices/xiaomi-band-9-pro/source/chinese`](devices/xiaomi-band-9-pro/source/chinese) |
| Xiaomi Smart Band 10 | 212×520 (212dp) | [`devices/xiaomi-band-10/source/chinese`](devices/xiaomi-band-10/source/chinese) |

## Language / 语言

**There is no in-app language switch. The app follows the device.** All text is
resolved by the Vela runtime through the platform's `$t()` against
`src/i18n/{zh-CN,en-US,defaults}.json`, so a Chinese band shows Chinese and an
English band shows English from the same package.
**没有应用内语言切换，跟随设备语言。** 全部文本由 Vela 运行时通过 `$t()` 对着
`src/i18n/*.json` 解析，同一个包在中/英文手环上分别显示中/英文。

`tools/build_i18n.js` is the single source of truth for every string.
`tools/build_i18n.js` 是所有文案的唯一真源。

## Features / 功能

- Built-in engine with four levels — Easy / Normal / Hard / Master
  (per-move budget 0.15 s / 1 s / 4 s / 10 s, depth cap 1 / 5 / 8 / 12).
  内置引擎四档难度，每步时间预算 0.15 / 1 / 4 / 10 秒。
- Two players on one band, or human vs AI (either colour). 双人同机，或人机对弈。
- Chess clock: unlimited or timed, with increments. 无限时 / 计时（含加秒）。
- Move hints, last-move highlight, undo, resign, draw. 走法提示、上一步高亮、悔棋、认输、和棋。
- Board panning and three square sizes; optional auto-centering. 棋盘平移、三档格子、自动居中。
- Games autosave and resume. 对局自动存档并可继续。
- Correct rules: castling, en passant, promotion, three-fold repetition,
  fifty-move rule, insufficient material, checkmate and stalemate.
  规则完整：易位、吃过路兵、升变、三次重复、五十步、子力不足、将杀与逼和。

## Build / 构建

These are Xiaomi Vela quick-app packages (`.rpk`), not Android APKs.
以下是 Vela 快应用包（`.rpk`），不是 Android APK。

```bash
bash tools/apply_all.sh      # regenerate pages, then run every check
bash tools/build_release.sh  # signed release .rpk (bumps versionCode)
node tools/package_rpk.js    # collect into releases/
```

`apply_all.sh` is idempotent and must be run before building — the device pages
are generated from the shared tools, not edited by hand.
`apply_all.sh` 是幂等的，构建前必须先跑；页面由工具生成，不要手改。

## Releases / 发布

Built, signed packages live in [`releases/`](releases):

- `Chess_Band9_v1.2.0_release.rpk`
- `Chess_Band9Pro_v1.2.0_release.rpk`
- `Chess_Band10_v1.2.0_release.rpk`

`.rpk` files are distributed through GitHub Releases rather than committed to
the tree. 安装包通过 GitHub Releases 分发，不入库。

## Archive / 归档

[`archive/english-version/`](archive/english-version) holds the **retired
separate English build** (v1.0.0, 2026-09-27): its `.rpk` and source archives
plus the English release documents. It was superseded by the single bilingual
tree described above, and is kept for history only — it is not built or shipped.

`archive/english-version/` 存放**已退役的独立英语版**（v1.0.0，2026-09-27）：
其安装包、源码归档和英语版发布文档。该版本已被上面的单一双语工程取代，
仅作历史留存，不参与构建与发布。

## Validation boundary / 验证边界

Every change is checked by the tool suite in `tools/` (page structure, template
handlers, i18n keys, layout fit, engine perft, move-generator parity, saved-game
size, and the contents of the built package). See `tools/apply_all.sh` for the
full list. 所有改动都由 `tools/` 下的校验脚本把关，完整清单见 `tools/apply_all.sh`。

Static checks and emulator-free tests cannot replace **real-device testing**:
install the `.rpk` on hardware and exercise touch, timing and rendering before
trusting a release. 静态校验与无设备测试**不能替代真机验证**：发布前请在实机上
验证触控、计时与渲染。

## License / 许可

Code: **GPL-3.0**, see [`LICENSE`](LICENSE). 代码采用 GPL-3.0。

Chess piece artwork: derived from the **cburnett** set by Colin M.L. Burnett,
licensed **CC-BY-SA-3.0**. 棋子素材来自 Colin M.L. Burnett 的 cburnett 套图，
采用 CC-BY-SA-3.0 许可。
