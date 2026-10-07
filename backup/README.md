# 源码备份目录（backup/）

本目录保存**每次重要改动前后的源码快照**，便于随时对照 / 回滚。

## 目录约定

```
backup/
├── original-source-<时间戳>/   改动前的原始源码
├── modified-source-<时间戳>/   改动后的源码
└── README.md
```

- 每个快照只收录**代码文件**（`.ux` / `.js` / `.json`），不含图片等二进制资源
  ——图片在 git 里本身就有完整历史，重复拷贝没有意义。
- 时间戳格式：`YYYYMMDD-HHMMSS`。
- 快照内部保留完整路径（`devices/<设备>/source/chinese/src/...`），
  直接 `diff -rq original-* modified-*` 即可看出改了什么。

---

## 快照记录

### 20261007-091806 / 20261007-091825 — Band 10 显示与按钮修复

**原始**：`original-source-20261007-091806`
**修改后**：`modified-source-20261007-091825`

**改动范围**：仅 `devices/xiaomi-band-10`（7 个文件）。
`xiaomi-band-9` 与 `xiaomi-band-9-pro` **未改动**（diff 核验为空）。

**修复的两个问题**：

1. **模拟器画面溢出 / 不铺满** —— 单位 `dp` -> `px`
   - `dp` 依赖设备密度 DPR（`物理像素 = dp值 x DPR`），
     官方模拟器 AVD 密度为 420（DPR 2.625），`212dp` 被放大到 556px，
     屏幕只有 212 宽 -> 溢出。
   - `px` 按 `designWidth` 等比缩放、与密度无关；
     本项目 `designWidth` 恰好等于物理宽度（212），缩放系数 = 1，两端一致。
   - 涉及：全部 7 个页面的 CSS 与 `{{...}}dp` 数据绑定，共 115 处。

2. **控制按钮全部点不动** —— `purchase.ux` 的 VM 声明冲突
   - 原代码同时声明 `protected:{firstLaunch}` 与 `data:{purchaseConfirmed}`，
     Vela 框架硬性禁止两者共存，页面 VM 构造时直接抛错。
   - 应用启动即跳转该页 -> 抛错 -> 路由中断 -> 之后所有按钮失效。
   - 修复：合并为单一 `protected:{firstLaunch, purchaseConfirmed}`，移除 `data`。

**Band 9 Pro 为何正常**：其 `purchase.ux` 只有 `data`、无 `protected`，不触发冲突。

> 注：以上结论基于官方多屏适配文档（`multi-screens_specs.md` 的单位定义）、
> 模拟器 AVD 档案（`avdConfigIni.json`）与 Vela 框架源码（编译产物中的校验逻辑）
> 三方交叉验证。**最终以真机 / 模拟器实测为准。**

---

### 20261007-093859 / 20261007-094143 — Band 9 + Band 9 Pro 显示修复（三设备全适配）

**原始**：`original-source-20261007-093859`
**修改后**：`modified-source-20261007-094143`

**改动范围**：`devices/xiaomi-band-9`（6 个文件）+ `devices/xiaomi-band-9-pro`（7 个文件）。
Band 10 的修复已在上一快照完成，本快照中保持不变。

**修复问题**：模拟器画面溢出 / 不铺满（与 Band 10 同一根因）
- 单位 `dp` -> `px`，与 Band 10 完全相同的处理方式。
- Band 9：`designWidth = 192`，替换 297 处 `<数字>dp` + 12 处 `}}dp`。
- Band 9 Pro：`designWidth = 336`，替换 339 处 `<数字>dp` + 12 处 `}}dp`。
- 两个设备的 JS 硬编码视口常量（`maxBoardLeft` / `maxBoardTop` / `centerOn`）
  经核验与 CSS 尺寸一一对应（192x264 / 336x280），改 px 后语义不变。
- 两设备**均无** Band 10 那个 `protected` + `data` 的 VM 冲突，
  因此原本按钮可以点，问题只表现在显示上。

**构建验证**：三设备 `aiot build` / `aiot release` 全部 `build success`，
包内 dp 残留均为 0。
