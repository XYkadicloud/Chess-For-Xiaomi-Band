# Xiaomi Smart Band 9 Chess Source

This directory contains the buildable English source for the offline Chess quick app on Xiaomi Band 9 Vela. The package is `com.xykadi.chess`; the design width is 192dp.

- App source: [`src`](src)
- Build command: `npm ci --cache .npm-cache && npm run build`
- Device baseline: 192×490 pixels / 192dp

The device-specific layout is intentionally kept separate from Band 9 Pro and Band 10. Preserve the route structure, storage keys, and Vela layout when making changes.
