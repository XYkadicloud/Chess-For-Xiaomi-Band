# Archived: the separate English build (v1.0.0, 2026-09-27)

**This directory is history. Nothing here is built, shipped, or referenced by
the tooling.**

**本目录仅为历史留存。这里的内容不参与构建、不发布，工具也不会引用。**

## What this was / 这是什么

Up to v1.0.0 the repository shipped **two independent source trees per device**:
`devices/<device>/source/chinese/` and `devices/<device>/source/english/`. Each
was a complete, separately buildable Vela project, and each had to be rebuilt
and released on its own — two packages per device, two things to keep in sync.

早期（v1.0.0 及以前）每个设备有**两套独立源码**：`source/chinese/` 与
`source/english/`，各自是完整可构建的工程，需要分别构建、分别发布。

## Why it was retired / 为什么退役

That split was replaced by **one tree per device that is bilingual at runtime**:
the text is resolved by the Vela runtime through `$t()` against
`src/i18n/{zh-CN,en-US,defaults}.json`, so the language follows the device.
One package now serves both languages, and there is no in-app language switch
to keep in sync.

后来改为**每设备一套源码，在运行时双语**：文本由 Vela 运行时通过 `$t()` 对着
`src/i18n/*.json` 解析，跟随设备语言。一个包同时服务中英文，也没有应用内
语言切换需要维护。

The `source/english/` trees were deleted at that point; what remained was the
release material below, which is what this archive collects.

`source/english/` 目录当时已删除，留下的是下面这些发布产物 —— 也就是本归档的内容。

## Contents / 内容

```
releases/<device>/english-20260927/    the English-only v1.0.0 packages + source
releases/<device>/bilingual-20260927/  the first bilingual packages + source
docs/ENGLISH_TRANSLATION_REPORT.md     translation audit
docs/ENGLISH_VERSION_PLAN.md           the (now obsolete) plan for the split build
docs/ENGLISH_BUILD_RELEASE_20260927.md the release notes for that build
docs/RELEASE_NOTES_EN.md               English release notes
```

Note that the **runtime** English text is *not* here — `src/i18n/en-US.json`
and `defaults.json` are live files the shipped app depends on, so they stay in
the source trees. This archive holds only the retired **build** material and the
documents that described it.

注意：**运行时**的英文文本不在本归档里 —— `src/i18n/en-US.json` 与
`defaults.json` 是线上应用依赖的活文件，仍留在源码树中。本归档只包含退役的
**构建产物**和描述它的文档。

## Restoring / 还原

The trees are still in git history if the split ever needs to be revisited:

```bash
git log --diff-filter=D -- devices/xiaomi-band-9/source/english
git show <commit>^:devices/xiaomi-band-9/source/english/README.md
```
