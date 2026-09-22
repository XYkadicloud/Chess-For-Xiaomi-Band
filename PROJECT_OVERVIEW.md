# Chess for Xiaomi Vela 项目全景说明书

更新时间：2026-09-21（Asia/Shanghai）

当前源码版本：`0.2.8`（versionCode `10`），包名为 `com.xykadi.chess`。本版本保留原始 12 张 PNG 棋子资源，移除首页 active storage 启动读取，删除棋盘坐标层，并把选中态/最近一步合并到棋盘格样式，减少首屏节点。棋局选项继续使用 `touchend`，棋盘继续使用单一父容器触摸分发。详细自检记录见 `FIX_NOTES_20260921.md`。

## 一、项目现状与演进计划

### 1. 已实现功能

本项目是面向 Xiaomi Band 9 的 Xiaomi Vela JS 快应用 Chess，目标是提供单设备离线双人西洋棋体验。当前主流程为：主界面 → 开始游戏 → 时间选择 → 游戏棋盘。主页现在只保留一个“开始游戏”入口；存在暂停棋局时，该入口自动恢复棋局。

已实现内容包括：

- 192dp × 490dp 手环窄长屏布局。
- 主界面、开始对局页、棋局页、棋局内菜单和下棋设置页。
- PNG 棋子资源渲染，不依赖设备 SVG 解析。
- 标准、放大、紧凑三种棋盘大小。
- 棋盘横向/纵向拖动和自动居中。
- 棋子选择、合法落子提示、选中态、最近一步标记。
- 基础西洋棋规则及主要终局判定。
- 双方独立倒计时、超时结束和终局停止。
- 悔棋、认输、和棋、再来一局、查看棋局、退出对局。
- 设置持久化以及开始对局前的棋盘尺寸启动配置传递。
- 触摸更新节流、合法走法缓存等性能优化。
- 多个带时间和修复说明的 RPK 版本及源码备份。

### 2. 未实现功能与盲区

- 当前没有完整的 PGN 记录、棋局历史页面和二维码导出。
- 升变当前自动变为后，尚未提供升变棋子选择界面。
- `common/js/bridge.js` 和 `search.js` 是扩展/遗留模块，当前 Chess 主流程不依赖它们。
- `components/InputMethod` 是旧输入法组件，当前构建主流程不依赖它；构建辅助目录中会排除它以避免旧资源路径警告。
- 尚未建立自动化棋规单元测试，复杂残局需要继续进行真机回归。

### 3. 当前 Roadmap

短期优先级：

1. 在真机验证棋盘尺寸启动传递、终局锁定和计时停止。
2. 添加棋局内部历史结构和标准 PGN 转换。
3. 添加“历史棋局”页面，按回合数和时间保存。
4. 添加棋谱二维码生成。

中期优先级：

1. 升变选择后/车/象/马。
2. 完善 FIDE 规则测试，包括边界王车易位、吃过路兵和重复局面。
3. 将棋规逻辑拆为可独立测试的模块。

## 二、架构与文件结构

### 当前有效结构

```text
https-iot-mi-com-vela-quickapp-9/
├── package.json                 # npm 脚本和 aiot-toolkit 依赖
├── package-lock.json            # npm 锁定版本
├── .npmrc                       # npm 镜像配置（若存在）
├── README.md                    # 原项目说明
├── jsconfig.json                # 编辑器/JS 配置
├── src/
│   ├── manifest.json            # 包名、设备、路由、系统能力
│   ├── app.ux                   # 应用生命周期和屏幕常亮
│   ├── common/
│   │   ├── icon.png             # 应用图标
│   │   ├── pieces/*.png         # Vela 使用的棋子位图
│   │   ├── pieces/*.svg         # 历史/设计资源，主流程不依赖
│   │   └── js/
│   │       ├── bridge.js        # interconnect/SimpleFetch 桥接
│   │       └── search.js        # DuckDuckGo HTML 搜索和正文解析
│   ├── pages/
│   │   ├── index/index.ux       # 主界面
│   │   ├── setup/setup.ux       # 时间、棋盘尺寸和启动配置
│   │   ├── game/game.ux         # 棋盘、规则、计时、菜单和终局
│   │   ├── settings/settings.ux # 持久化下棋设置
│   │   ├── menu/menu.ux         # 历史独立菜单页，主游戏已改为内嵌菜单
│   │   ├── search/search.ux     # 搜索输入页
│   │   ├── results/results.ux   # 搜索结果页
│   │   └── reader/reader.ux     # 网页纯文字阅读页
│   └── components/InputMethod/  # 旧输入法组件及图片资源
├── dist/                        # 已生成的带版本名 RPK 文件
├── backups/                     # 每次重要修复的源码快照
├── PROJECT_OVERVIEW.md          # 本说明书
├── PROJECT_SKILLS.md            # Skill 能力清单
└── package_export.ps1           # 一键导出脚本
```

### 核心文件解析

#### `src/manifest.json`

定义包名 `com.codex.test.chess`、应用名 Chess、watch 设备类型、192dp 设计宽度、系统能力以及所有页面路由。`system.storage` 用于设置和启动配置保存。

#### `src/app.ux`

应用入口。通过应用生命周期调用 `system.brightness` 的常亮能力，避免下棋时屏幕过快休眠。

#### `src/pages/index/index.ux`

主界面，提供开始游戏、下棋设置和退出应用入口，使用 `/common/icon.png` 显示应用图标。

#### `src/pages/setup/setup.ux`

开始对局页。选择每方用时，并读取 `CHESS_SETTINGS` 中的棋盘大小。启动时把尺寸转换成 24/30/44 数值，写入 `CHESS_LAUNCH_BOARD_SIZE`，再进入游戏页，规避手环路由中文参数解析不稳定的问题。

#### `src/pages/game/game.ux`

核心业务文件，包含：

- 8×8 棋盘和棋子位图渲染。
- 触摸拖动、自动居中和棋盘尺寸应用。
- 选子和合法走法缓存。
- 基础棋规、将军、将死、逼和、王车易位、吃过路兵、升变和重复局面判定。
- 双方计时、超时、悔棋、认输、和棋和终局锁定。
- 游戏内菜单和设置层。

#### `src/pages/settings/settings.ux`

保存走法提示、自动居中、认输确认、棋盘动画和棋盘大小到 `CHESS_SETTINGS`。

#### `src/common/pieces/*.png`

棋子位图资源。实际游戏使用 PNG，避免 Xiaomi Vela 设备不支持标准 SVG 动态渲染的问题。

#### `src/common/js/bridge.js`

保留 `SF_HANDSHAKE`、`SF_PING`、`SF_REQUEST` 等 SimpleFetch/interconnect 桥接协议实现，为未来网络调用预留。

#### `src/common/js/search.js`

DuckDuckGo HTML 搜索、结果解析、网页正文清理和链接提取，属于扩展浏览模块，不参与离线棋局主路径。

#### `dist/*.rpk`

RPK 安装包。文件名包含修复主题、版本和时间，便于安装回溯。`com.codex.test.chess.debug.0.2.0.rpk` 是较早的历史包，其余带 `Chess-` 前缀的文件是带说明的版本副本。

#### `backups/`

保存重要修改前后的 `src` 快照，可用于人工回退和差异对照。

## 三、项目 Skill 提取

系统当前可以抽象为以下能力集合：

- **Wearable UI Skill**：窄长胶囊屏的竖向布局、触控区域和 dp 适配。
- **Vela Packaging Skill**：manifest、AIoT Toolkit、debug RPK 和版本化导出。
- **Offline Chess Skill**：单设备双人棋局、合法走法、计时和终局。
- **Chess Rule Skill**：主要西洋棋规则和局面判定。
- **Low-resource Rendering Skill**：PNG 资源、减少动态重绘、触摸帧节流和缓存。
- **Persistent Settings Skill**：Vela storage 设置保存、启动配置交接和备份恢复。
- **Version Traceability Skill**：源码快照、RPK 命名、SHA-256 校验和回溯。
- **Network Extension Skill**：interconnect/SimpleFetch 和搜索模块的扩展基础。

## 四、构建和导出

### 开发构建

```powershell
npm install --cache .npm-cache
npm run build
```

官方 AIoT-IDE 的开发模式会生成 `dist` 和 `build` 目录，并在 `dist` 中生成 debug RPK。

### 一键导出

```powershell
powershell -ExecutionPolicy Bypass -File .\package_export.ps1
```

脚本会：

1. 创建临时导出目录。
2. 复制当前 `src`、项目配置和 `README.md`。
3. 复制 `dist` 中全部 RPK。
4. 复制 `backups` 中源码快照。
5. 复制本说明书和 Skill 清单。
6. 生成 ZIP 到 `exports/`。

## 五、风险与验收建议

- 安装测试包前先卸载旧 RPK，避免手环缓存旧页面。
- 优先真机验证放大/紧凑尺寸、从设置返回游戏、和棋/认输后的计时和落子锁定。
- 任何棋规扩展应先写局面测试，再放入手环构建。
