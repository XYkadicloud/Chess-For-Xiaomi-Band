# 设备适配矩阵

| 设备 | 分辨率 | designWidth | 主源码目录 | RPK目录 | 状态 |
|---|---:|---:|---|---|---|
| Xiaomi Smart Band 9 | 192×490 | 192 | `devices/xiaomi-band-9/source/src` | `devices/xiaomi-band-9/releases` | 历史稳定版本 |
| Xiaomi Smart Band 9 Pro | 336×480 | 336 | `devices/xiaomi-band-9-pro/source/src` 与根目录 `src` | `devices/xiaomi-band-9-pro/releases` | 当前完整适配，已签名构建 |
| Xiaomi Smart Band 10 | 212×520 | 212 | `devices/xiaomi-band-10/source/src` | `devices/xiaomi-band-10/releases` | 独立适配版本 |

## 共同规则

- `deviceTypeList` 使用 Vela 快应用要求的 `watch`，不使用 `band`。
- 三种设备必须分别使用自己的 `designWidth`，禁止跨目录复制布局后直接构建。
- JSC 和 Protobuf 保持关闭。
- 签名私钥只在本地构建时提供，不进入仓库。
- 语言文案放在 `locales/` 规划目录，不复制三套设备代码。
