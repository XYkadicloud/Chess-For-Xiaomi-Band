# 安装包目录（releases/）

文件名格式：`Chess_<设备>_v<版本>_<签名>.rpk`

## v1.2.3（当前）

| 文件 | 设备 | 大小 |
|---|---|---|
| Chess_Band9_v1.2.3_release.rpk | Band9 | 143.2 KB |
| Chess_Band9Pro_v1.2.3_release.rpk | Band9Pro | 144.9 KB |
| Chess_Band10_v1.2.3_release.rpk | Band10 | 145.1 KB |

> **Band 11 与 Band 10 通用**，使用 Band10 的包即可。

### v1.2.2 修复内容（三设备统一）

**模拟器画面溢出 / 不铺满、比例错位** —— 全部页面单位 `dp` -> `px`

- `dp` 依赖设备密度 `DPR = PPI / 160`（`物理像素 = dp值 x DPR`）；
  官方模拟器 AVD 密度为 420（DPR 2.625），写 `212dp` 会被放大到 556px，
  而屏幕宽只有 212 -> 整体溢出、只显示左上角一块。
- `px` 按 `designWidth` 等比缩放、**与设备密度无关**；
  本工程 `designWidth` 恰好等于物理宽度（192 / 336 / 212），
  缩放系数 = 1，模拟器与真机表现一致。
- 覆盖范围：Band9 297+12 处、Band9Pro 339+12 处、Band10 115 处。

**Band 10 额外修复：所有控制按钮点不动**
- `purchase.ux` 同时声明 `protected` 与 `data`，Vela 框架硬性禁止共存，
  页面 VM 构造时抛错 -> 启动跳转该页即中断路由 -> 之后所有按钮失效。
- 修复：合并为单一 `protected:{firstLaunch, purchaseConfirmed}`。


### v1.2.3 修复内容

1. **右滑返回失效（三设备）** —— `game.ux` 的 `@swipe="blockSwipe"` 原本绑在
   页面根容器上，吞掉了系统返回手势；改绑到棋盘视口，返回手势恢复、
   棋盘拖拽仍受保护。
2. **Band 9 补上「诚信付款」页** —— 新增 `pages/purchase` + 首页首启跳转
   + 关于页付款入口 + 路由（此前只有 i18n 文案、页面缺失）。

### 历史版本

| 版本 | 设备 | 说明 |
|---|---|---|
| v1.2.1 | Band9, Band10 | Band 10 修复首版（9 Pro 未含） |
| v1.2.0 | Band9, Band9Pro, Band10 | 存档体积与选子性能修复 |

说明：
- 本目录由 `tools/package_rpk.js` 生成，重新构建后再次运行即刷新。
- **每个设备只有一个包**，中英文已合并：文本由 Vela 运行时通过 `$t()`
  对着 `src/i18n/*.json` 解析，**跟随设备语言**。**没有应用内语言切换**。
- 所有构建共用同一个包名 `com.xykadi.chess`，只有**文件名**不同；
  改 manifest 的 `package` 会让手环把新包当成另一个应用，无法覆盖升级。
- `_debug` 表示调试签名包，仅用于本地安装测试；正式分发需要 release 签名。
