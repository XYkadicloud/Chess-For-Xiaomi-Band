# 当前可调用 Skill 清单

以下是本次工作区上下文中可调用的 Skill。导出包中的 `skill-exports/` 保存了各 Skill 的入口 `SKILL.md`，用于回顾其能力范围和使用说明。

## 项目直接使用

- `vela-quickapp-dev`：小米 Vela JS 快应用、Lua、NuttX 开发与构建参考。
- `vela-watch-design`：小米 Vela 手表/手环 UI 设计、布局和组件规范。

## 当前上下文可调用的其他 Skill

- `imagegen`：生成或编辑位图图片资源。
- `openai-docs`：OpenAI/Codex 产品和官方文档查询。
- `plugin-creator`：创建 Codex 插件。
- `skill-creator`：创建或更新 Codex Skill。
- `skill-installer`：安装 Skill。
- `computer-use`：控制 Windows 应用和浏览器。
- `documents`：创建、编辑和验证 Word 文档。
- `pdf`：读取、创建、渲染和验证 PDF。
- `plugin-management`：发现和管理插件连接。
- `presentations`：创建和编辑演示文稿。
- `spreadsheets`：创建、编辑和分析电子表格。
- `excel-live-control`：控制连接中的 Microsoft Excel。
- `template-creator`：创建可复用的 Codex 模板 Skill。
- `visualize`：创建可视化和交互式工具。

## 说明

Skill 是 Codex 的开发能力说明和工作流程，不是本 Chess 应用运行时依赖。导出的 Skill 文件仅用于项目交接和能力回顾，不会被打包进 Vela RPK。
