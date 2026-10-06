# Chess Vela 1.0.0 Bilingual Release Notes (English)

Release date: 2026-09-27

This release provides separate Chinese and English Xiaomi Vela JS quick-app projects and build packages for Xiaomi Smart Band 9, Xiaomi Smart Band 9 Pro, and Xiaomi Smart Band 10.

## Language and source layout

Every device has two complete, clearly separated source directories:

- `devices/xiaomi-band-9/source/chinese/` and `source/english/`
- `devices/xiaomi-band-9-pro/source/chinese/` and `source/english/`
- `devices/xiaomi-band-10/source/chinese/` and `source/english/`

The Chinese source is restored from the pre-translation 1.0.0 source baseline. The English source is the translated 1.0.0 version. Both languages retain the same package name, version, chess rules, storage keys, route structure, and device-specific layout; only user-visible text differs.

## Build packages

These are Xiaomi Vela quick-app RPK packages, not Android APK files. The release contains 12 current installation packages: Chinese and English Debug plus Chinese and English Production for each device:

| Device | Screen baseline | Chinese RPK | English RPK |
|---|---:|---|---|
| Band 9 | 192×490 / 192dp | Included in this release | Included in this release |
| Band 9 Pro | 336×480 / 336dp | Included in this release | Included in this release |
| Band 10 | 212×520 / 212dp | Included in this release | Included in this release |

All 12 packages use `aiot-toolkit 2.0.4`, version `1.0.0`, version code `100`, and passed non-empty RPK, manifest, ZIP integrity, and SHA-256 checks. Production packages were signed with the project-generated certificate supplied for this release; the private key was used only in a temporary local signing directory and was not committed or uploaded.

## Build command

From any device's `source/chinese/` or `source/english/` directory, run:

```bash
npm ci --cache .npm-cache
npm run build
```

## Validation boundary

Source static checks, manifest parity checks, device-dimension checks, UX JavaScript syntax checks, and all six toolkit builds completed successfully. No physical Xiaomi Band installation test was performed, so this release does not claim true-device functional regression coverage.
