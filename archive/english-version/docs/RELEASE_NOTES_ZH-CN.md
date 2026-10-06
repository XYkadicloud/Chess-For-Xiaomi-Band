# Chess Vela 1.0.0 双语发布说明（中文）

发布日期：2026-09-27

本次发布为 Xiaomi Smart Band 9、Xiaomi Smart Band 9 Pro 和 Xiaomi Smart Band 10 提供中文和英文两套独立的 Vela JS 快应用工程及构建包。

## 语言与目录

每个设备都具有以下两个互不混淆的完整源码目录：

- `devices/xiaomi-band-9/source/chinese/` 与 `source/english/`
- `devices/xiaomi-band-9-pro/source/chinese/` 与 `source/english/`
- `devices/xiaomi-band-10/source/chinese/` 与 `source/english/`

中文源码恢复自翻译前的 1.0.0 源码基线；英文源码采用已完成翻译的 1.0.0 版本。两种语言保持相同的包名、版本号、棋规、存储键、路由结构和设备屏幕适配，仅用户可见文字不同。

## 构建包

这是 Xiaomi Vela 快应用 RPK，不是 Android APK。本 Release 共包含 12 个当前安装包：每台设备各有中文 Debug、英文 Debug、中文 Production 和英文 Production：

| 设备 | 屏幕基准 | 中文 RPK | 英文 RPK |
|---|---:|---|---|
| Band 9 | 192×490 / 192dp | 已上传至本 Release | 已上传至本 Release |
| Band 9 Pro | 336×480 / 336dp | 已上传至本 Release | 已上传至本 Release |
| Band 10 | 212×520 / 212dp | 已上传至本 Release | 已上传至本 Release |

全部 12 个包均使用 `aiot-toolkit 2.0.4`、版本 `1.0.0`、版本号 `100`，并通过了非空 RPK、manifest、ZIP 完整性和 SHA-256 校验。Production 包使用本次提供的项目自生成证书签名；私钥只在本地临时签名目录中使用，没有提交或上传。

## 构建命令

进入任一设备的 `source/chinese/` 或 `source/english/` 后执行：

```bash
npm ci --cache .npm-cache
npm run build
```

## 验证边界

已完成源码静态检查、manifest 对照、设备尺寸检查、UX JavaScript 语法检查和六套构建。没有在真实 Xiaomi Band 设备上安装测试，因此本次发布不宣称真机功能回归通过。
