# Sims 4 Cottage Loading Screen Migrator — Web

Browser-based bulk migrator for Sims 4 Cottage Loading Screen `.package` files.
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
