# Development Timeline

## 项目目标

项目目标是在 Xiaomi Band 9 的 Vela 系统上实现离线国际象棋快应用。应用由单个手环运行，支持两个人在同一设备上轮流操作棋子。优先级一直是实机稳定性、低内存占用和可用触摸交互，其次才是历史、PGN 和完整棋规。

## 早期阶段

项目最初是一个 Vela JS 快应用原型，具有首页、setup、game、settings、history 和 historyDetail 页面。首页曾经同时出现“开始游戏”和“新建对局”两个重复入口。后来统一为只保留“开始游戏”，setup 页面承担新局配置。

早期实现使用较复杂的页面状态、页面参数和 storage 恢复链路。模拟器能够运行，但这些链路在手环上存在页面初始化不稳定的风险。

## 0.2.1 到 0.2.3 归档阶段

历史对话中记录了 0.2.1 的棋盘尺寸和启动参数修复。源码归档中的 manifest 实际标记为 0.2.3。旧版棋局页已经包含 64 个动态格子、棋子图片、菜单和 PGN 等功能，但仍依赖 `data`、`this.$page` 和启动 storage。

对比旧版后确认，旧版并不是一个可以直接回退的低内存实现。它的棋子 PNG 资源很小，图片不是主要风险；主要风险是首屏页面结构、状态初始化和动态节点组合。

## 0.2.4 到 0.2.6 阶段

这个阶段修复了首页重复按钮、棋局初始化、页面参数读取、时钟启动、暂停保存、恢复逻辑、撤销快照上限、页面销毁后的定时器以及应用全局常亮副作用。还修复了部分历史详情恢复参数和 `data/protected` 页面模型冲突。

0.2.6 使用了 `private` 页面状态以避免 Vela VM 在 game 和 historyDetail 页面上出现状态模型冲突。

## 0.2.7 实机低内存阶段

用户在 Band 9 原机上测试时发现，模拟器能够正常进入棋局，但原机点击开始游戏后重启。为区分路由问题和 game 页问题，项目制作了极简烟雾测试包。烟雾包保留首页、setup 和路由，但把 game 页替换为只显示“棋局页面已打开”的轻量页面。

烟雾包在原机上可以正常打开。这说明首页、setup 和基础路由不是主要根因，正式 game 页的页面创建或渲染峰值概率最高。

0.2.7 随后移除了启动阶段的 storage 链路，使用一个棋盘父容器处理触摸，减少 64 个独立点击监听，并清理不再参与启动的历史恢复代码。

## 0.2.8 阶段

0.2.8 对旧归档与当前源码进行对比。图片资源恢复到源码目录，但不恢复旧版不稳定的启动逻辑。首页现在不再读取 active game storage。棋盘删除坐标层，并把 selected 和 lastMove 的视觉状态合并到每个棋盘格的 style 属性。PNG 棋子节点继续保留。

同时将包名从 `com.codex.test.chess` 改为 `com.xykadi.chess`，版本升级为 0.2.8，versionCode 为 10。AIoT Toolkit 构建成功。

## 当前会话交接

用户要求把源码、当前聊天、开发文档、问题说明、实现过程和下一步计划上传到一个新 GitHub 仓库，并将当前源码和整理后的资料同步到原有 GitHub 仓库。本文件和 `AGENT_HANDOFF.md` 是为下一个 Agent 编写的交接入口。项目原始长对话保存在 `项目AI对话.md`，当前会话的结论与交接要求保存在 `CURRENT_CHAT_HANDOFF.md`。

## 当前结论

当前最高概率问题是正式 game 页面在 Band 9 原机上的内存或渲染峰值。暂时不要把历史、PGN 和更多棋规功能重新接入首次 game 初始化。下一步应该采用分层、逐项加回功能的真机测试方式。

## References

[1]: https://github.com/XYkadicloud/Chess-For-Xiaomi-Band "Chess for Xiaomi Band build repository"
[2]: https://github.com/XYkadicloud/Chess-for-miband9-use-agent "Chess for Mi Band 9 agent handoff repository"
