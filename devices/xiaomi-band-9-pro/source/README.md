# Chess for Xiaomi Vela Bands

小米 Vela 手环国际象棋快应用。仓库已经按目标设备明确分类，避免 Xiaomi Smart Band 9、Band 9 Pro 和 Band 10 的屏幕基准与构建产物混淆。

## 设备版本总览

| 设备目录 | 屏幕规格 | 设计宽度 | 当前内容 |
|---|---:|---:|---|
| [`devices/xiaomi-band-9`](devices/xiaomi-band-9) | 192×490 | 192dp | Band 9 源码、历史归档和公开 RPK |
| [`devices/xiaomi-band-9-pro`](devices/xiaomi-band-9-pro) | 336×480 | 336dp | Band 9 Pro 完整可构建源码、签名正式 RPK、审计报告 |
| [`devices/xiaomi-band-10`](devices/xiaomi-band-10) | 212×520 | 212dp | Band 10 源码、公开 RPK 和校验文件 |

根目录保留 **Xiaomi Smart Band 9 Pro** 当前工程，便于直接执行构建；设备专属的完整源码副本也放在对应 `devices/*/source/` 目录中。

## 目录规则

```text
devices/
├── xiaomi-band-9/
│   ├── source/       # 192×490 Band 9 源码与历史归档
│   └── releases/     # Band 9 RPK、旧版本和校验文件
├── xiaomi-band-9-pro/
│   ├── source/       # 336×480 Band 9 Pro 完整工程源码
│   └── releases/     # Band 9 Pro Debug/正式签名 RPK与审计资料
└── xiaomi-band-10/
    ├── source/       # 212×520 Band 10 完整工程源码
    └── releases/     # Band 10 普通正式 RPK与校验文件

docs/
├── DEVICE_MATRIX.md          # 三种设备的适配矩阵
└── ENGLISH_VERSION_PLAN.md   # 英语版本预留方案
```

## 当前 Band 9 Pro 构建

根目录和 `devices/xiaomi-band-9-pro/source/` 使用相同的 336×480 适配基线：

```bash
npm ci --cache .npm-cache
node tools/verify_band9pro_adaptation.js
node tools/audit_band9pro_layout.js
npm run build
npm run release
```

JSC 和 Protobuf 保持关闭，以避免目标设备启动兼容性问题。签名私钥不属于仓库内容；正式签名构建需要在本地安全提供证书和私钥。

## 安全说明

本次整理只上传公开源码、公开资源、RPK、校验文件和审计文档。**不会上传 `private.pem`、任何私钥、包含私钥的签名压缩包或构建临时目录。**

## 英语版本

英语版本暂不混入设备目录，统一预留在 [`locales/`](locales/)；设备适配和语言内容分离，后续可以为同一设备分别加入 `zh-CN` 与 `en-US` 文案，而不复制三套设备布局。

## 许可证

本项目源代码采用 **GNU General Public License v3.0（GPL-3.0）** 发布，具体条款见 [`LICENSE`](LICENSE)。本许可证说明不代表对 Xiaomi、Vela、Xiaomi Band 或其他第三方商标、平台和资源授予额外权利。

## 官方设备资料

- [Xiaomi Smart Band 9 Pro Global Specs](https://www.mi.com/global/product/xiaomi-smart-band-9-pro/specs/)
- [Xiaomi Smart Band 10 Global Specs](https://www.mi.com/global/product/xiaomi-smart-band-10/specs/)
