# 安装包目录（releases/）

文件名格式：`Chess_<设备>_v<版本>_<签名>.rpk`

| 文件 | 设备 | 大小 |
|---|---|---|
| Chess_Band9_v1.2.0_release.rpk | Band9 | 162.3 KB |
| Chess_Band9Pro_v1.2.0_release.rpk | Band9Pro | 166.2 KB |
| Chess_Band10_v1.2.0_release.rpk | Band10 | 166.4 KB |

说明：

- 本目录由 `tools/package_rpk.js` 生成，重新构建后再次运行即刷新。
- **每个设备只有一个包**，中英文已合并：首次启动跟随设备语言，
  用户也可以在「设置 → 语言」里手动切换（跟随系统 / 中文 / English）。
- 所有构建共用同一个包名 `com.xykadi.chess`，只有**文件名**不同；
  这是有意为之——改 manifest 的 `package` 会让手环把新包当成另一个应用，
  无法覆盖升级，也会影响签名与调试。
- `_debug` 表示调试签名包，仅用于本地安装测试；正式分发需要 release 签名。
