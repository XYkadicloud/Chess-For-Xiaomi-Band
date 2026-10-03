# 安装包目录（releases/）

文件名格式：`Chess_<设备>_<语言>_v<版本>_<签名>.rpk`

| 文件 | 设备 | 语言 | 大小 |
|---|---|---|---|
| Chess_Band9_中文_v1.0.0_release.rpk | Band9 | 中文 | 109.3 KB |
| Chess_Band9_英文_v1.0.0_release.rpk | Band9 | 英文 | 108.9 KB |
| Chess_Band9Pro_中文_v1.0.0_release.rpk | Band9Pro | 中文 | 113.7 KB |
| Chess_Band9Pro_英文_v1.0.0_release.rpk | Band9Pro | 英文 | 113.1 KB |
| Chess_Band10_中文_v1.0.0_release.rpk | Band10 | 中文 | 113.8 KB |
| Chess_Band10_英文_v1.0.0_release.rpk | Band10 | 英文 | 113.2 KB |

说明：

- 本目录由 `tools/package_rpk.js` 生成，重新构建后再次运行即刷新。
- 所有构建共用同一个包名 `com.xykadi.chess`，只有**文件名**不同；
  这是有意为之——改 manifest 的 `package` 会让手环把新包当成另一个应用，
  无法覆盖升级，也会影响签名与调试。
- `_debug` 表示调试签名包，仅用于本地安装测试；正式分发需要 release 签名。
