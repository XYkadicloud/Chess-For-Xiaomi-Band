# Chess for Xiaomi Vela Bands / 小米 Vela 手环国际象棋

Offline two-player chess quick app for Xiaomi Vela bands. 本项目是运行在 Xiaomi Vela 手环上的离线双人国际象棋快应用。

## Bilingual release / 双语发布

The repository contains **separate Chinese and English source trees for every device**. Each language directory is a complete, independently buildable Vela project. 仓库为每个设备提供**独立分开的中文和英文源代码目录**；每个语言目录都是可以单独构建的完整 Vela 工程。

| Device / 设备 | Screen / 屏幕 | Chinese source / 中文源码 | English source / 英文源码 |
|---|---:|---|---|
| Xiaomi Smart Band 9 | 192×490 / 192dp | [`source/chinese`](devices/xiaomi-band-9/source/chinese) | [`source/english`](devices/xiaomi-band-9/source/english) |
| Xiaomi Smart Band 9 Pro | 336×480 / 336dp | [`source/chinese`](devices/xiaomi-band-9-pro/source/chinese) | [`source/english`](devices/xiaomi-band-9-pro/source/english) |
| Xiaomi Smart Band 10 | 212×520 / 212dp | [`source/chinese`](devices/xiaomi-band-10/source/chinese) | [`source/english`](devices/xiaomi-band-10/source/english) |

Chinese source is restored from the pre-translation 1.0.0 baseline commit. English source is the translated and validated 1.0.0 source. 中文源码恢复自翻译前的 1.0.0 基线提交；英文源码是已翻译并验证的 1.0.0 源码。

## Build / 构建

These are Xiaomi Vela quick-app packages (`.rpk`), not Android APK files. 以下是 Xiaomi Vela 快应用包（`.rpk`），不是 Android APK 文件。

Run the following inside the desired language directory. 请在目标设备和语言目录中执行：

```bash
npm ci --cache .npm-cache
npm run build
```

For example / 示例：

```bash
cd devices/xiaomi-band-9/source/english
npm ci --cache .npm-cache
npm run build
```

The build output is written to that language project's `dist/` directory. 构建产物会写入对应语言工程的 `dist/` 目录。

## Releases / 发布

- [Bilingual release notes — English](docs/RELEASE_NOTES_EN.md)
- [双语发布说明 — 中文](docs/RELEASE_NOTES_ZH-CN.md)
- [GitHub bilingual release / GitHub 双语发布](https://github.com/XYkadicloud/Chess-For-Xiaomi-Band/releases/tag/v1.0.0-bilingual-20260927)

Each device release directory contains language-labelled RPK files, complete source archives, and SHA-256 files. 每个设备的发布目录都包含带语言标识的 RPK、完整源码归档和 SHA-256 校验文件。

## Validation boundary / 验证边界

The Chinese and English source trees have been checked for manifest parity, device-specific design widths, page structure, UX script syntax, and successful toolkit builds. 中文和英文源码已检查 manifest 一致性、设备设计宽度、页面结构、UX 脚本语法，并完成 Toolkit 构建。

No physical Band 9, Band 9 Pro, or Band 10 installation test was performed in this sandbox. 本次沙箱环境未在真实 Band 9、Band 9 Pro 或 Band 10 上安装和回归测试。

## License / 许可证

GPL-3.0. See [`LICENSE`](LICENSE). 本项目采用 GPL-3.0，详见 [`LICENSE`](LICENSE)。
