# English Version

The active source trees now contain English UI text for all three device targets without duplicating or changing their chess logic.

## Device targets

- `devices/xiaomi-band-9/source/` — Xiaomi Band 9, 192dp
- `devices/xiaomi-band-9-pro/source/` — Xiaomi Band 9 Pro, 336dp
- `devices/xiaomi-band-10/source/` — Xiaomi Band 10, 212dp

## Translation rules applied

1. Translated user-visible UX text and source-package README files to English.
2. Preserved route names, storage keys, chess rules, dimensions, assets, and device-specific layout.
3. Converted board-size display values to `Standard`, `Large`, and `Compact`.
4. Kept backward-compatible reads for existing Chinese board-size values, while new writes use English values.
5. Build and release are intentionally not performed in this translation-only phase.
