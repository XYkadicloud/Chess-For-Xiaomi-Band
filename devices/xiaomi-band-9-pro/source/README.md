# Xiaomi Smart Band 9 Pro Chess Source

This directory contains the buildable English source for the offline Chess quick app on Xiaomi Band 9 Pro Vela. The package is `com.xykadi.chess`; the design width is 336dp.

- App source: [`src`](src)
- Build command: `npm ci --cache .npm-cache && npm run build`
- Device baseline: 336×480 pixels / 336dp

The device-specific layout is intentionally kept separate from Band 9 and Band 10. Preserve the route structure, storage keys, and Vela layout when making changes.
