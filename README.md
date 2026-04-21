# Sims 4 Loading Screen Migrator

[![Deploy to GitHub Pages](https://github.com/KostaGorod/ts4-toolbox/actions/workflows/deploy.yml/badge.svg)](https://github.com/KostaGorod/ts4-toolbox/actions/workflows/deploy.yml)
[![Website](https://img.shields.io/website?url=https%3A%2F%2Fkostagorod.github.io%2Fts4-toolbox%2F&label=site&style=flat-square)](https://kostagorod.github.io/ts4-toolbox/)
[![License: MIT](https://img.shields.io/github/license/KostaGorod/ts4-toolbox?style=flat-square)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/KostaGorod/ts4-toolbox?style=flat-square&logo=github)](https://github.com/KostaGorod/ts4-toolbox/stargazers)
[![Forks](https://img.shields.io/github/forks/KostaGorod/ts4-toolbox?style=flat-square&logo=github)](https://github.com/KostaGorod/ts4-toolbox/network/members)
[![Last commit](https://img.shields.io/github/last-commit/KostaGorod/ts4-toolbox?style=flat-square)](https://github.com/KostaGorod/ts4-toolbox/commits/main)
[![Built with Bun](https://img.shields.io/badge/bun-1.3.11-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.com/)
[![Vite](https://img.shields.io/badge/vite-8-646cff?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)

Fixes the **llama-plumbob flicker glitch** on old custom loading-screen
`.package` mods: the spinning plumbob keeps swapping frames with a llama head
mid-spin. It happens when the `.package` was authored against an older Sims 4
GFX format; the current game's renderer stumbles on the outdated container.

This tool rebuilds each old package against the current in-game loading-screen
template so the plumbob stays a plumbob.

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
