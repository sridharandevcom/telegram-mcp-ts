import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "auth/cli": "src/auth/cli.ts",
  },
  format: ["esm"],
  target: "node18",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  shims: true,
  // gramjs is large and CJS-ish internally; keep it external so it resolves at runtime.
  external: ["telegram"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
