# Chess for Xiaomi Band 9 Vela

这是运行在 Xiaomi Band 9 Vela 系统上的离线 JS 快应用项目。当前主线源码为 **Chess 1.0.0**，包名为 `com.xykadi.chess`，开发者为 `XYKadi`。

## 从哪里开始

新 Agent 应先阅读：

1. [`AGENT_HANDOFF.md`](AGENT_HANDOFF.md)：仓库原有技术交接资料。
2. [`docs/AGENT_HANDOFF_20260925.md`](docs/AGENT_HANDOFF_20260925.md)：当前 1.0.0 源码、页面结构、关于页状态和下一步真机验收要求。
3. [`docs/RELEASE_CATALOG.md`](docs/RELEASE_CATALOG.md)：当前版本和历史归档索引。

## 目录分类

| 目录 | 内容 |
|---|---|
| `src/` | 当前可构建的 1.0.0 源码、页面、manifest 和图片资源。 |
| `tools/` | 当前版本使用的专项校验脚本，以及历史兼容性校验脚本。 |
| `history/` | 用户原始上传源码、时间修复前快照和原始源码压缩包。只读保存，不作为当前构建输入。 |
| `releases/` | 已生成的版本 RPK、源码归档和 SHA-256 文件。 |
| `dist/` | 仓库历史上保留的 0.2.x RPK 构建产物。 |
| `diagnostics/` | 早期 Band 9 原机低内存和路由烟雾测试资料。 |
| `docs/` | 当前交接文档和版本索引。 |

## 当前源码构建

```bash
npm ci --cache .npm-cache
node tools/verify_about_release.js
node tools/verify_pause_resume.js
npm run build
```

构建入口在 `package.json` 中定义为 `aiot build`。当前版本使用 `aiot-toolkit` 2.0.4，设计宽度为 192dp，设备类型为 `watch`。

## 当前 1.0.0 交付物

最新 RPK 位于 [`releases/1.0/`](releases/1.0/)。该目录包含当前构建包、完整源码归档和 SHA-256 校验文件。主线 `src/` 与该源码归档保持同步。

当前版本已经包含独立关于页、开发者头像、应用图标、爱发电二维码和二维码大图页。关于页的真机滚动和视觉尺寸仍应在 Band 9 上进行最终验收，详细要求见当前交接文档。

## 历史版本

历史源码和不可直接作为当前构建输入的资料位于 [`history/`](history/)。历史 RPK 位于 [`dist/`](dist/)，版本归档包位于 [`exports/`](exports/)。这些资料用于回退、对比和问题定位，不应直接覆盖当前 `src/`。

## Git 约定

当前可构建源码保留在仓库根目录的 `src/`，历史源码只放在 `history/`，交付物只放在 `releases/`。修改当前版本时应先备份 `src/`，完成专项校验后再提交。不要把 `node_modules/`、`build/`、临时目录或日志提交到仓库。

## 开源许可证

本项目源代码采用 **GNU General Public License v3.0（GPL-3.0）** 发布，具体条款见仓库根目录的 [`LICENSE`](LICENSE) 文件。

GPL-3.0 要求分发本项目或其衍生作品时遵守相同许可证的再发布义务，并保留版权和许可证声明。`releases/` 中的 RPK 属于由本项目构建的发布产物；发布或再分发时，也应同时遵守 GPL-3.0 以及其中包含的第三方代码和资源所适用的额外条款。

本许可证说明不代表对 Xiaomi、Vela、Xiaomi Band、AstroBox 或其他第三方商标、平台、服务和资源授予额外权利。
## References

[1]: https://github.com/XYkadicloud/Chess-For-Xiaomi-Band "Chess for Xiaomi Band build repository"

[2]: https://github.com/XYkadicloud/Chess-for-miband9-use-agent "Chess for Mi Band 9 agent handoff repository"
