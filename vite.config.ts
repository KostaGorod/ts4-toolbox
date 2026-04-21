import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  base: "./",
  plugins: [
    nodePolyfills({
      // @s4tk/models deep-imports (dbpf.ts) only touch Buffer + zlib; the
      // XML/image resources that used to pull in stream/util/events/assert
      // are no longer in the graph.
      include: ["buffer", "zlib", "stream"],
      globals: { Buffer: true, global: false, process: false },
    }),
  ],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
});
