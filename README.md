# Sims 4 Loading Screen Migrator

[![Deploy](https://github.com/KostaGorod/ts4-toolbox/actions/workflows/deploy.yml/badge.svg)](https://github.com/KostaGorod/ts4-toolbox/actions/workflows/deploy.yml)
[![Live on GitHub Pages](https://img.shields.io/badge/live-kostagorod.github.io%2Fts4--toolbox-7aa9ff?style=flat-square)](https://kostagorod.github.io/ts4-toolbox/)
[![License: MIT](https://img.shields.io/github/license/KostaGorod/ts4-toolbox?style=flat-square)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/KostaGorod/ts4-toolbox?style=flat-square)](https://github.com/KostaGorod/ts4-toolbox/stargazers)
[![Repo hits](https://hits.sh/github.com/KostaGorod/ts4-toolbox.svg?style=flat-square&label=repo%20hits&color=7aa9ff&labelColor=222736)](https://hits.sh/github.com/KostaGorod/ts4-toolbox/)
[![Site visits](https://hits.sh/kostagorod.github.io/ts4-toolbox.svg?style=flat-square&label=site%20visits&color=7aa9ff&labelColor=222736)](https://hits.sh/kostagorod.github.io/ts4-toolbox/)

Fixes the **spinning-plumbob-forever bug** caused by old custom loading-screen
`.package` files that were authored against an older Sims 4 GFX format. The
current game silently rejects them, leaving you stuck on the loading screen.

This tool rebuilds each old package against the current in-game loading-screen
template so the plumbob actually stops spinning and the game loads.

Hosted build: **https://kostagorod.github.io/ts4-toolbox/**

Uses [`@s4tk/models`](https://github.com/sims4toolkit/models) for DBPF I/O. The
Scaleform GFX manipulation lives here because S4TK treats GFX payloads as
opaque.

Licensed under the [MIT License](LICENSE).

## Develop

```
bun install
bun run dev
```

Open the printed localhost URL, drop `.package` files onto the drop zone.
`public/empty-new.gfx` is the bundled newer-game template; users don't need to
supply one.

## Build

```
bun run build
```

Static output lands in `dist/`. The included GitHub Actions workflow publishes
`dist/` to GitHub Pages on every push to `main`.

## How it works

1. **Read old package**: `@s4tk/models` `Package.extractResources` decompresses
   the single GFX resource.
2. **Migrate GFX**: walk the tag stream, pull the `DefineBitsLossless2` bitmap,
   insert it into the newer-game template at the next free character ID, and
   rewrite the background `DefineShape(id=6)` to use a bitmap fill.
3. **Write new package**: `@s4tk/models` writes a fresh DBPF v2.1 container with
   the original instance ID, zlib-compressing the GFX payload.

All processing is in-browser — no uploads, no backend.
