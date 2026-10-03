# 棋子素材来源与许可 / Piece asset provenance

## 来源

本项目棋盘上的 12 个棋子位图（`devices/*/source/*/src/common/pieces/*.png`）
由 **lichess 默认棋子集 cburnett** 的矢量素材光栅化而来：

- 上游：<https://github.com/lichess-org/lila>，目录 `public/piece/cburnett/`
- 素材集：`cburnett`（lichess 网站对局界面默认使用的就是这一套）
- 作者：**Colin M.L. Burnett**
- 许可证：**GPLv2+**（见 `tools/_icons/lichess/LICENSE`）
- 原始文件：`tools/_icons/lichess/*.svg`（12 个，已随本仓库保留一份）

上游原始文件名是大写（`wK.svg` / `bQ.svg`…），本地按小写命名
（`wk.svg` / `bq.svg`…），内容未做任何修改。

> **许可证说明**：GPLv2+ 要求保留署名与许可证原文，本仓库公开且已包含
> 上述 LICENSE 文件，满足要求。若将来要改为闭源分发，需要重新评估。
> 旧版的 `meridian` 素材（CC0）仍保留在 `tools/_icons/meridian/` 供参考，
> 但**已不再被使用**。

## 为什么不用 SVG

小米手环 Vela OS 的 `<image>` 组件**不能渲染 SVG**。素材必须以位图形式
打包进 RPK，因此需要一次离线的 SVG → PNG 转换。

## 转换方式

`tools/build_piece_png.py` 负责转换：

1. 用 `svglib` 解析 SVG 为 reportlab 绘图对象（纯 Python，不依赖原生 cairo）。
   svglib 已经把椭圆弧 `a` 命令降级成三次贝塞尔，所以无需自己实现圆弧。
2. 用 Pillow 按 `moveTo / lineTo / curveTo / closePath` 手工光栅化路径，
   三次贝塞尔曲线按 24 段展开。
3. 4 倍超采样后 LANCZOS 缩放，得到干净的边缘。

### 配色：按 SVG 自身的颜色决定，而不是按棋子颜色

这是本项目踩过的一个坑。cburnett 的真实配色并不是"白棋浅底深边、黑棋深底浅边"，
而是：

| 棋子 | 填充 | 轮廓描边 | 内部细节描边 |
|---|---|---|---|
| 白棋 `w*` | `#ffffff` | `#000000` | — |
| 黑棋 `b*` | `#000000` | **`#000000`（也是黑的）** | `#ececec`（浅色） |

也就是说**黑棋整体是纯黑的，连轮廓边也是黑的**；让它在深色格上不糊成一块的，
是它内部那几笔**浅色细节**（后的腰线、象的斜缝、马的鬃毛与眼睛、车的一道箍）。

早期版本想当然地"给黑棋套一圈浅色描边"，结果每枚黑棋都变成一圈肥厚的白边、
中间看起来是空的——这正是真机上"为什么还没换成 lichess 样式"的直接原因。

因此脚本按**描边颜色本身**分派，而不是按棋子颜色：

- 填充 `#fff` / `#000` → 取该棋子对应的主体色（白 `#ffffff` / 近黑 `#1a1a1a`）
- 描边亮度 ≤ 0.5（即 `#000`）→ **轮廓**：白棋画近黑 `#111111`，黑棋画近黑 `#1a1a1a`
- 描边亮度 > 0.5（即 `#ececec`）→ **内部细节**：黑棋保持浅色 `#ececec`

### 几何

- 缩放基准用 `drawing.width`（= 33.75，即 45 × 0.75 的 viewBox 已烘焙进
  组变换），**不要**按实际墨迹包围盒归一化：cburnett 的留白是刻意的，
  按墨迹放大会把比例放大 ~2.6 倍，描边也跟着变粗。
- svglib 输出的组变换含 Y 翻转 `(0.75, 0, 0, -0.75, 0, 33.75)`，而 PIL 的
  像素 Y 轴本来就向下，所以要**抵消**这个翻转，否则棋子会上下镜像。
- `ZOOM = 1.14`：把 viewBox 略微收小，让棋子在约 24dp 的格子里占得满一些。

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
- **颜色身份**（三向，依据实测的正确配色模型）：
  - 白棋整枚以亮色像素为主（light ≥ 30%）；
  - 黑棋整枚以暗色像素为主（dark ≥ 55%）；
  - 两者在轮廓（不透明像素与透明相邻处）都必须是**深色**（dark rim ≥ 40%）；
  - 黑棋还必须保留其源素材本来就有的浅色内部细节量
    （见 `BLACK_DETAIL_MIN`；`bP` 是纯剪影、下限为 0）。
    这一条专门用来抓"细节被主体色盖掉"的回归——那会让黑棋在深色格上糊成一块。
- `game.ux` 引用的是 `/common/pieces/<name>.png`，且没有残留 `.svg` 引用；
- 源码树中不残留 `.svg` 棋子文件。
