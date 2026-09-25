# Chess for Xiaomi Band 9 Vela — Agent Handoff

**项目用途。** 本项目是一个运行在 Xiaomi Band 9 Vela 系统上的离线 JS 快应用。它提供单设备双人轮流进行的国际象棋对局，不依赖网络、账号或手机伴侣。项目面向资源受限的手环运行环境，因此页面创建峰值、动态节点数量、事件监听数量和异步存储链路都比普通 Web 应用更重要。

## 当前交付版本

当前源码版本为 **0.2.8**，`versionCode` 为 `10`，正式包名为 `com.xykadi.chess`。最新 RPK 为 `dist/com.xykadi.chess.debug.0.2.8.rpk`。该版本已经通过 AIoT Toolkit 编译，并通过项目内的源码检查器。

0.2.8 保留 12 张 PNG 棋子图片以及原有图标资源。棋局页仍从 `/common/pieces/<piece>.png` 加载棋子图片。图片不是本次实机重启的主要原因；12 张棋子 PNG 总大小约为 6 KB。

## 用户已经确认的现象

在模拟器中，0.2.6 及后续版本可以正常运行。在 Xiaomi Band 9 原机上，点击“开始游戏”并进入正式棋局页时应用会重启。时间选择页面也曾出现选择异常。一个只保留首页、setup 页面和极简 game 页面、去除棋盘与棋规的烟雾测试包可以在原机正常打开。因此，基础路由和最小页面 VM 基本正常，正式 game 页面创建或渲染阶段的性能/内存峰值是当前最高概率根因。

模拟器正常不能证明真机可用。模拟器拥有更宽松的内存和渲染能力，手环则可能在首次创建页面时因节点数量、图片节点、overlay、事件监听、计算和异步链路同时出现而重启。

## 当前已完成的主要工作

早期版本先移除了首页重复的“开始游戏”和“新建对局”入口，只保留“开始游戏”。setup 页面增加了时间选项，并加入“无限制”时间控制。setup 的选择交互改用更适合手环的 `touchend`，并避免启动阶段读取普通设置。

随后修复了多个 Vela 页面模型和生命周期问题。主要包括避免 `data` 与 `protected` 状态模型冲突，移除全应用常亮副作用，清理页面销毁后的定时器，限制撤销快照，处理无限制模式下不启动无意义时钟，以及减少棋盘独立触摸监听。

0.2.7 针对实机低内存做了进一步优化。game 页面使用单一棋盘父容器处理触摸，而不是为 64 个格子创建独立 click 监听。启动路径不再先读取 storage 再决定棋局，历史和 PGN 恢复暂时不进入首次棋局初始化。

0.2.8 对旧归档进行了比较。项目内的源码归档 manifest 实际标记为 0.2.3，而不是用户所称的 0.2.2。旧版本仍有 `data`、`this.$page` 和多次启动 storage 读取，不能直接回退。当前版本保留旧版本的轻量 PNG 资源，删除棋盘坐标层，并把 selected 与 lastMove 的视觉状态合并到棋盘格自身的 style 属性。首页不再读取 active game storage，点击“开始游戏”始终进入 setup 页面。

## 当前源码结构

`src/pages/index/index.ux` 是首页，只负责稳定地进入 setup、历史页和设置页。`src/pages/setup/setup.ux` 负责选择时间控制、无限制模式以及开始棋局。`src/pages/game/game.ux` 包含棋盘、触摸分发、走法生成、基本规则、计时、菜单和暂时保留的历史/PGN 功能。`src/pages/settings/settings.ux` 是独立设置页。`src/pages/history` 和 `src/pages/historyDetail` 是历史功能页面，但历史和 PGN 不是当前实机稳定性的重点。

`src/common/pieces` 保存 12 张 PNG 和 12 张 SVG 棋子资源。当前 game 页面使用 PNG。`tools/verify_vela_source.js` 负责源码和棋规的回归检查。`tools/audit_device_compat.js` 负责页面事件、动态棋盘格、storage 调用、深拷贝和能力声明的静态审计。

## 当前已知问题

第一，正式 game 页面仍然是单个大型 UX 页面，首屏会创建 64 个动态棋盘格，并保留菜单、设置、结果、升变和 PGN 的模板分支。静态审计仍报告约 31 个模板事件绑定、64 个动态格子、深拷贝 JSON 操作以及 8 个非启动阶段 storage 调用。这些功能在模拟器中可能正常，但在 Band 9 原机上仍可能导致页面创建或后续交互峰值过高。

第二，历史棋局和 PGN 保存恢复尚未可靠完成。用户已经明确表示这些功能可以暂时放在后面，因此不要为了优先修复实机启动而重新把历史恢复接入 onInit。

第三，棋盘触摸坐标仍有固定布局偏移和横向/纵向平移逻辑。需要在真机上重新确认坐标系、状态栏影响和圆屏裁切。这个问题可能造成点选偏移，但通常不会解释进入 game 页面即重启。

第四，独立设置与棋局内设置已经统一了主要键名，但真机上仍需要验证自动居中、走法提示、认输确认和棋盘大小的持久化行为。设置读写不应重新放回首次 game 页面创建路径。

第五，0.2.8 改用了棋盘格 style 属性来合并状态。必须在真机上确认 Vela 当前 Toolkit 对动态 style 中 `border` 字符串的兼容性。如果出现渲染异常，应改为单个低成本 overlay 或固定背景色方案，而不是恢复多层子节点。

## 下一步建议

下一步应制作一个“正式棋局分层版”，而不是继续在现有单页上添加功能。首屏只创建回合文字、两个时钟、棋盘父容器、64 个必要棋盘格和 PNG 棋子。菜单、设置、升变、结果和 PGN 应当延迟到用户首次打开对应功能时创建，或者拆成独立页面。

建议按以下顺序在真机上逐项验证：先验证首屏无棋规计算是否能稳定显示；然后加入棋子图片；再加入棋盘触摸；再加入合法走法提示；最后加入时钟。每次只增加一个功能，并保留可安装 RPK。这样能够确定具体导致重启的功能层。

如果最小棋盘加 PNG 棋子仍然重启，应制作不含图片的棋盘包，进一步区分图片解码与页面节点问题。如果不含图片的棋盘正常而含图片重启，应把 PNG 统一压缩到更小尺寸，并减少同屏图片节点。如果不含棋盘的极简 game 正常，而含 64 格棋盘重启，则应采用更低节点的棋盘绘制策略或分批创建。

历史、PGN、完整将军约束、三次重复、五十回合、王车易位和吃过路兵应在实机启动稳定后再继续开发。不要把这些功能和低内存启动修复放在同一个变更中。

## 编译方式

构建壳来自 GitHub 仓库 `XYkadicloud/Chess-For-Xiaomi-Band`。构建流程是把当前 `src` 和 `tools` 覆盖到构建壳，然后运行 `npm ci` 与 `npm run build`。最终 RPK 会输出到 `dist/com.xykadi.chess.debug.0.2.8.rpk`。如果未来版本号变化，需要同步修改 `src/manifest.json` 和 `tools/verify_vela_source.js` 的版本断言。

## 交接给新 Agent 的工作规则

新 Agent 必须先读取本文件、`FIX_NOTES_20260922.md`、`DEVICE_AUDIT_20260922.md`、`PROJECT_OVERVIEW.md`、`PROJECT_SKILLS.md`、`tools/verify_vela_source.js` 和 `tools/audit_device_compat.js`。修改前必须备份 `src`。所有真机性能修改都应保持一个可回退的 RPK。不要把模拟器成功当作真机成功。不要在没有分流测试的情况下继续猜测性地改动历史、PGN 或棋规。

## 相关文件

- [项目总览](PROJECT_OVERVIEW.md)
- [0.2.8 修复说明](FIX_NOTES_20260922.md)
- [设备兼容性审计](DEVICE_AUDIT_20260922.md)
- [原始历史对话](项目AI对话.md)
- [当前棋规说明](chess.md)
- [源码检查器](tools/verify_vela_source.js)
- [设备审计器](tools/audit_device_compat.js)

## References

[1]: https://github.com/XYkadicloud/Chess-For-Xiaomi-Band "Chess for Xiaomi Band build repository"
[2]: https://github.com/XYkadicloud/Chess-for-miband9-use-agent "Chess for Mi Band 9 agent handoff repository"
