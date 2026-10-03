# 棋子素材来源与许可 / Piece asset provenance

## 来源

本项目棋盘上的 12 个棋子位图（`devices/*/source/*/src/common/pieces/*.png`）
由 **CC0（公有领域）** 的矢量素材光栅化而来：

- 仓库：<https://github.com/kmar/chess_svg_piece_sets>
- 素材集：`meridian`
- 原始文件：`tools/_icons/meridian/*.svg`（12 个，已随本仓库保留一份）
- 许可证：见 `tools/_icons/meridian/LICENSE`（CC0 / Public Domain Dedication）
- 作者：kmar（及该素材集的贡献者）

CC0 意味着可以自由用于任何用途（含商业），无需署名；此处保留署名仅为
来源可追溯。

## 为什么不用 SVG

小米手环 Vela OS 的 `<image>` 组件**不能渲染 SVG**。素材必须以位图形式
打包进 RPK，因此需要一次离线的 SVG → PNG 转换。

## 转换方式

`tools/build_piece_png.py` 负责转换：

1. 用 `svglib` 解析 SVG 为 reportlab 绘图对象（纯 Python，不依赖原生 cairo）。
2. 用 Pillow 按 `moveTo / lineTo / curveTo / closePath` 手工光栅化路径，
   三次贝塞尔曲线按 24 段展开。
3. 4 倍超采样后 LANCZOS 缩放，得到干净的边缘。
4. 每枚棋子渲染**两次**，使用两套配色：

   | 棋子 | 填充 | 描边 |
   |---|---|---|
   | 白棋 `w*` | 纯白 `#ffffff` | 近黑 `#111111` |
   | 黑棋 `b*` | 近黑 `#1a1a1a` | 近白 `#f0f0f0` |

   这样白棋在浅色格（`#B8B8B8`）上、黑棋在深色格（`#3A3A3A`）上都能看清。
   描边宽度按 `STROKE_SCALE = 0.62` 收细——原始 2 单位描边在后这类线条密集的
   棋子（尤其是后）上会把主体压成暗块，收细后白/黑主体面积才占优。

5. 几何按**实际包围盒**归一化后再居中留边（`margin = 4.5%`）。
   注意 svglib 对这些文件报告的 `width/height` 是 48×48，而坐标实际跨 0–64，
   所以不能直接用 `drawing.width` 做缩放基准。

## 重新生成

需要一个带 `svglib` + `reportlab` + `Pillow` 的 Python 环境：

```bash
# 一次性准备（隔离 venv，不污染系统环境）
PY="C:/Users/HP/.workbuddy-ai/binaries/python/versions/3.13.12/python.exe"
VENV="C:/Users/HP/.workbuddy-ai/binaries/python/envs/pieces"
"$PY" -m venv "$VENV"
"$VENV/Scripts/python.exe" -m pip install svglib reportlab pillow

# 生成 + 安装 + 校验
"$VENV/Scripts/python.exe" tools/build_piece_png.py   # -> tools/_pieces_out/*.png
node tools/install_pieces.js                          # -> 6 套工程
node tools/verify_pieces.js                           # 断言完整性
```

`tools/apply_all.sh` 会在开头自动执行这三步（若 venv 或源 SVG 缺失则跳过，
保留已安装的位图）。

## 校验规则

`tools/verify_pieces.js` 对每套工程断言：

- 12 个 PNG 齐全，且都是合法 PNG、≥64×64、RGBA；
- 每枚棋子都有实际可见像素（非空白）；
- **白棋以亮色像素为主、黑棋以暗色像素为主**——这条直接对应"黑白格上都看得清"；
- `game.ux` 引用的是 `/common/pieces/<name>.png`，且没有残留 `.svg` 引用；
- 源码树中不残留 `.svg` 棋子文件。
