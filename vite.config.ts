import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

function gitRevParse(args: string[]): string {
  try {
    return execFileSync("git", ["rev-parse", ...args], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const commitShortSha = gitRevParse(["--short=7", "HEAD"]) || "dev";
const commitFullSha = gitRevParse(["HEAD"]);

export default defineConfig({
  base: "./",
  define: {
    __COMMIT_SHA__: JSON.stringify(commitShortSha),
    __COMMIT_SHA_FULL__: JSON.stringify(commitFullSha),
  },
  plugins: [
    nodePolyfills({
      include: ["buffer", "zlib", "stream", "util", "events", "assert"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
});
