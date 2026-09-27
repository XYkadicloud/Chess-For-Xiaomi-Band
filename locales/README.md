# Locales

The current English build is applied directly to the active source trees so each device package can be built independently.

## Device source trees

- `devices/xiaomi-band-9/source/src` — Xiaomi Band 9, 192dp
- `devices/xiaomi-band-9-pro/source/src` — Xiaomi Band 9 Pro, 336dp
- `devices/xiaomi-band-10/source/src` — Xiaomi Band 10, 212dp

The active UI strings are English. The chess rules, route names, storage keys, device-specific dimensions, and image resources are unchanged. Existing saved Chinese board-size values are read for backward compatibility and normalized to English values when saved.
