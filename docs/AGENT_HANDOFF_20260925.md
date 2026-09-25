# Chess for Xiaomi Band 9 Vela — Agent Handoff

**交接日期：** 2026-09-25  
**项目类型：** Xiaomi Band 9 Vela JS 快应用  
**应用名称：** Chess  
**包名：** `com.xykadi.chess`  
**当前版本：** `1.0.0`，`versionCode: 100`  
**开发者：** XYKadi  
**设计宽度：** 192dp  
**当前目标设备：** Xiaomi Band 9，Vela OS，`deviceTypeList: ["watch"]`

> 本文只记录项目结构、文件职责、当前进度和下一步修改范围。按照用户要求，不在这里展开完整功能说明。

## 一、当前总体状态

项目已经从用户提供的源码整理为一个可以使用 AIoT Toolkit 编译的完整 Vela 快应用工程。当前构建链路完整，包含 `package.json`、`package-lock.json`、`.npmrc`、`src/` 和 `dist/`。最近一次构建成功，RPK 中已经包含应用图标、开发者头像、爱发电二维码、关于页和二维码大图页。

最近一次生成的安装包为：

`/home/ubuntu/Chess-Vela-1.0-about-final.rpk`

最近一次生成的源码归档为：

`/home/ubuntu/Chess-Vela-1.0-about-final-source.tar.gz`

最近一次 RPK SHA-256 为：

```text
49448fb2db1a5e48aa7039386daeecdfc5b2f99a652e311c6f02afe2ce38b93f
```

源码静态校验和 AIoT Toolkit 构建均已通过。当前仍然缺少的是**最新 RPK 在 Xiaomi Band 9 真机上的最终人工验收**，尤其需要验收关于页的纵向滚动、头像显示尺寸、规则说明布局、爱发电二维码点击区域和二维码大图页返回路径。

## 二、项目根目录文件

| 文件或目录 | 作用 |
|---|---|
| `.npmrc` | npm 和 AIoT Toolkit 的项目级配置。构建时必须保留。 |
| `package.json` | Node 项目配置，定义 `npm run build` 和 `npm run release`，并声明 `aiot-toolkit: 2.0.4`。 |
| `package-lock.json` | 锁定 AIoT Toolkit 及其依赖版本，构建前使用 `npm ci --cache .npm-cache`。 |
| `src/` | Vela 快应用源代码、页面、manifest 和图片资源的根目录。 |
| `build/` | AIoT Toolkit 生成的中间构建目录，包含构建后的 `app.js`、`manifest.json` 和设备相关 manifest。通常不直接编辑。 |
| `dist/` | 当前构建产生的 RPK 和 SHA-256 校验文件。 |
| `tools/` | 当前项目使用的源码检查脚本。 |
| `tools_verify_vela_source.js` | 历史上复制出的校验脚本副本。它不是当前主校验入口，修改时不要优先依赖它。 |
| `node_modules/` | npm 安装的构建依赖，不属于业务源代码。交接归档时可以排除。 |
| `.npm-cache/` | npm 缓存目录，不属于业务源代码。交接归档时可以排除。 |

## 三、`src/` 目录和文件职责

### 3.1 应用入口与应用清单

| 文件 | 作用 |
|---|---|
| `src/app.ux` | 应用级根组件。负责渲染页面插槽，并通过 `@system.brightness` 尝试保持屏幕常亮。 |
| `src/manifest.json` | 应用清单。定义包名、应用名称、图标路径、版本、设备类型、设计宽度、系统能力、入口页面和全部路由页面。 |

当前 manifest 的关键内容如下：

```json
{
  "package": "com.xykadi.chess",
  "name": "Chess",
  "icon": "/common/icon.png",
  "versionName": "1.0.0",
  "versionCode": 100,
  "config": { "designWidth": 192 }
}
```

当前使用的系统能力只有 `system.router`、`system.app`、`system.storage` 和 `system.brightness`。旧版的 interconnect、vibrator、device 能力已从构建目录中清理，避免 Toolkit 因未使用的旧页面和旧脚本报 missing feature。

### 3.2 公共图片资源

| 文件 | 作用 |
|---|---|
| `src/common/icon.png` | 应用图标。首页使用，manifest 也使用它作为应用图标。 |
| `src/common/avatar.jpg` | 开发者头像。当前已替换为用户上传的 `IMG_20260905_205731_818.jpg`，在独立关于页的作者卡片中使用。 |
| `src/common/aifadian_qr.jpg` | 用户上传的爱发电主页二维码，在关于页预览和二维码大图页中使用。 |

### 3.3 棋子资源

`src/common/pieces/` 保存 12 个棋子 PNG 和对应的 SVG 文件。

| 文件组 | 作用 |
|---|---|
| `wK.png`、`wQ.png`、`wR.png`、`wB.png`、`wN.png`、`wP.png` | 白王、白后、白车、白象、白马、白兵的运行时 PNG 图片。 |
| `bK.png`、`bQ.png`、`bR.png`、`bB.png`、`bN.png`、`bP.png` | 黑王、黑后、黑车、黑象、黑马、黑兵的运行时 PNG 图片。 |
| 同名 `.svg` 文件 | 历史或设计资源。当前对局页实际加载 PNG，不依赖 SVG 动态解析。 |

### 3.4 页面文件

当前 manifest 注册了六个页面。

| 页面文件 | 路由 | 作用 |
|---|---|---|
| `src/pages/index/index.ux` | `/pages/index` | 首页。显示应用图标和入口按钮；读取 `CHESS_ACTIVE_GAME`，有未结束棋局时显示“继续对局”，否则显示“开始游戏”；提供下棋设置、关于和退出应用入口。 |
| `src/pages/setup/setup.ux` | `/pages/setup` | 新对局设置页。选择每方用时、无限制时间和棋盘大小，然后把 `minutes`、`unlimited`、`boardSize`、`resume` 参数直接传给对局页。 |
| `src/pages/game/game.ux` | `/pages/game` | 核心对局页。负责棋盘显示、回合显示、棋子点击、触摸平移、棋规判断、计时、暂停、菜单、设置、悔棋、退出和活动棋局保存恢复。 |
| `src/pages/settings/settings.ux` | `/pages/settings` | 独立下棋设置页。保存走法提示、自动居中、认输确认、棋盘动画开关和棋盘尺寸。使用 `CHESS_SETTINGS` 存储键。 |
| `src/pages/about/about.ux` | `/pages/about` | 独立关于页。当前按用户最新要求使用 Vela `<list>` 纵向列表，依次展示应用图标和版本、开发者头像和姓名、应用说明与规则说明、爱发电入口和二维码预览。 |
| `src/pages/support/support.ux` | `/pages/support` | 爱发电二维码独立大图页。点击关于页底部的二维码区域后进入，显示更大的二维码、支持说明和返回关于按钮。 |

### 3.5 已移除的旧页面

以下页面曾经存在于用户早期源码中，但当前主流程不使用，且其中的旧脚本会触发额外系统能力依赖，因此已经从当前构建工作区移除：

- `pages/menu`
- `pages/search`
- `pages/results`
- `pages/reader`
- `components/InputMethod`
- `common/js/bridge.js`
- `common/js/search.js`

如果未来要恢复这些页面，必须同时检查 manifest 的 feature 声明、资源相对路径和真机内存压力。不要直接把它们放回当前构建目录后立即编译。

## 四、当前校验脚本

| 文件 | 作用 |
|---|---|
| `tools/verify_about_release.js` | 校验应用版本、关于页、作者头像、二维码、support 路由和资源文件。 |
| `tools/verify_pause_resume.js` | 校验暂停、退出后恢复、活动棋局存储、菜单暂停计时、无限制时间和相关页面脚本语法。 |
| `tools/verify_time_center_fix.js` | 早期时间选择和自动居中修复的专项校验脚本。由于项目后来加入了独立关于页和新版本结构，它不是完整回归入口，但仍可作为历史参考。 |
| `tools/verify_vela_source.js` | 从历史仓库复制的旧版综合校验脚本。它要求旧版本号和旧页面集合，当前项目不应把它当作最终验收标准，除非先同步更新断言。 |

当前推荐的校验命令是：

```bash
node tools/verify_about_release.js
node tools/verify_pause_resume.js
npm run build
```

## 五、当前已经做到的范围

当前工程已经完成以下交接相关工作：

1. 完成从用户源码到可构建 Vela 项目的整理。
2. 将应用版本提升到 1.0，manifest 使用 `1.0.0 / 100`。
3. 修复时间选择参数传递和自动居中设置读取。
4. 加入暂停计时和退出快应用后的活动棋局恢复。
5. 菜单和下棋设置打开期间停止计时。
6. 加入无限制时间模式，显示 `∞`，不启动计时器，也不触发超时。
7. 删除 3 分钟时间选项。
8. 修正对局顶部白方回合、黑方回合的居中显示。
9. 将对局菜单改为全屏菜单。
10. 将关于入口改成独立页面，而不是首页悬浮窗。
11. 将用户真实头像 `IMG_20260905_205731_818.jpg` 接入开发者卡片。
12. 将用户提供的爱发电二维码接入关于页和独立二维码页面。
13. 将关于页重构为 Vela `<list>` 纵向滚动结构。
14. 重新编译并确认 RPK 内包含 `icon.png`、`avatar.jpg`、`aifadian_qr.jpg`、关于页和二维码大图页。

## 六、当前还需要继续修改或验收的内容

用户当前明确要求的目标是关于页最终呈现效果，而不是再增加新的业务功能。下一位 Agent 应优先完成真机验收和必要的视觉修正：

1. 将最新 RPK 安装到 Xiaomi Band 9，确认关于页是否能通过手指上下拖动浏览完整内容。
2. 确认内容顺序必须保持为：页面标题“关于” → 应用图标 → 版本号 → 独立开发者头像和 `XYKadi` → 同一个信息区域中的应用说明、已支持规则和未完整支持规则 → 最底部爱发电主页入口和二维码。
3. 确认开发者头像使用 `/common/avatar.jpg`，不能再回退为 `/common/icon.png`。
4. 确认二维码预览尺寸在真机上可辨认，点击二维码或“点击查看大图二维码”后进入 `/pages/support`。
5. 确认返回键不会贴到屏幕边缘，并且可以通过 `touchend` 正常返回。
6. 如果真机仍然显示内容重叠，应优先调整 `about.ux` 中的 `list` 高度、`list-item` 固定高度、内边距和字体行高，不要重新改回悬浮窗或普通静态 `scroll`。
7. 如果 Vela 真机不支持当前 `list-item` 的静态内容布局，应采用多个固定高度的 `list-item`，每个 item 保持一个明确的根节点；不要使用没有固定内容高度的多层 `div` 堆叠。
8. 真机验收通过后，再更新 `dist/SHA256SUMS-1.0.0.txt` 和最终交接文档中的 RPK 哈希。

## 七、构建和交付注意事项

构建前应确认当前目录没有把备份源码放在项目根目录的扫描范围内。AIoT Toolkit 会扫描项目内容，若把完整备份放在 `backups/` 中，备份里的相对资源路径可能导致构建失败。备份应放在项目目录外，例如 `/home/ubuntu/work_chess_backup/`。

标准构建步骤如下：

```bash
cd /home/ubuntu/work_chess
npm ci --cache .npm-cache
node tools/verify_about_release.js
node tools/verify_pause_resume.js
npm run build
sha256sum dist/com.xykadi.chess.debug.1.0.0.rpk
```

当前构建使用 AIoT Toolkit 2.0.4。构建产物默认以 `com.xykadi.chess.debug.1.0.0.rpk` 命名。构建成功后必须检查 RPK 文件非空，并确认以下资源存在于压缩包中：

```text
manifest.json
common/icon.png
common/avatar.jpg
common/aifadian_qr.jpg
pages/about/about.ux
pages/support/support.ux
```

不要把“构建成功”当作“真机显示正确”。Vela 模拟器或 Toolkit 构建只能证明语法、资源和打包链路基本通过；关于页的滚动、字体、图片尺寸和触摸区域仍需在 Band 9 真机确认。

## 八、当前文件交付位置

当前最新安装包：

[Chess-Vela-1.0-about-final.rpk](/home/ubuntu/Chess-Vela-1.0-about-final.rpk)

当前最新完整源码包：

[Chess-Vela-1.0-about-final-source.tar.gz](/home/ubuntu/Chess-Vela-1.0-about-final-source.tar.gz)

当前 SHA-256 文件：

[SHA256SUMS-1.0.0.txt](/home/ubuntu/work_chess/dist/SHA256SUMS-1.0.0.txt)

## References

[1]: https://github.com/XYkadicloud/Chess-For-Xiaomi-Band "Chess for Xiaomi Band build repository"

[2]: https://github.com/XYkadicloud/Chess-for-miband9-use-agent "Chess for Mi Band 9 agent handoff repository"
