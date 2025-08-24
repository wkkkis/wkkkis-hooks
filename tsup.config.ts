import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["cjs"],
  sourcemap: false,
  target: "node18",
  minify: false,
  splitting: false,
  clean: true,
  shims: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
