# Xiaomi Smart Band 10 Chess Source

This directory contains the buildable English source for the offline Chess quick app on Xiaomi Band 10 Vela. The package is `com.xykadi.chess`; the design width is 212dp.

- App source: [`src`](src)
- Build command: `npm ci --cache .npm-cache && npm run build`
- Device baseline: 212×520 pixels / 212dp

The device-specific layout is intentionally kept separate from Band 9 and Band 9 Pro. Preserve the route structure, storage keys, and Vela layout when making changes.
