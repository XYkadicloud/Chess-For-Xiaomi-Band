# English Translation Report

Date: 2026-09-27

## Scope

Translated the active Xiaomi Vela Chess quick-app source for:

- Xiaomi Smart Band 9 — 192dp / 192×490
- Xiaomi Smart Band 9 Pro — 336dp / 336×480
- Xiaomi Smart Band 10 — 212dp / 212×520

## Changes

- Translated user-visible UI strings in the active `.ux` pages to English.
- Translated the three source-package README files.
- Translated validator expectations that directly inspect the translated active UI.
- Changed board-size display values from Chinese to `Standard`, `Large`, and `Compact`.
- Added backward-compatible reads for existing saved Chinese board-size values; new writes use English values.
- Preserved chess rules, route names, storage keys, device dimensions, image resources, and page structure.
- Updated `locales/README.md` and `docs/ENGLISH_VERSION_PLAN.md` to describe the completed English source.

## Validation completed

- 23 UX page scripts extracted and checked with Node.js syntax validation: **PASS**.
- Active source trees contain no Chinese UI/source text: **PASS**.
- `git diff --check`: **PASS**.
- `verify_about_release.js`: **PASS** for Band 9, Band 9 Pro, and Band 10.
- `verify_pause_resume.js`: **PASS** for Band 9, Band 9 Pro, and Band 10.

## Not performed in this phase

- `npm ci` / `npm run build`: not run; this was translation-only as requested.
- RPK generation, device installation, true-device testing, GitHub upload, and release publishing: not performed.

## Existing repository validator mismatches

The repository's older validators still contain baseline assumptions unrelated to this translation:

- Band 9 `verify_vela_source.js` expects version `0.2.8`, while the active manifest is `1.0.0`.
- Band 9 `verify_time_center_fix.js` expects an older page list and does not include the current About/Support pages.

These were not changed because changing the app version or page inventory would exceed the translation-only scope.
