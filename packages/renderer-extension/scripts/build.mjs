import { build } from "esbuild";
import path from "node:path";
import { readPersonalBuildIdentity } from "../../../scripts/release/personal-build.mjs";

import { tailwindEsbuildPlugin } from "./tailwind-esbuild-plugin.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const identity = readPersonalBuildIdentity(path.resolve(packageRoot, "../.."));
const entries = [
  { entry: "src/index.ts", format: "esm", outfile: "dist/index.js" },
  { entry: "src/production-entry.ts", format: "iife", outfile: "dist/production.js" },
  { entry: "src/probe-entry.ts", format: "iife", outfile: "dist/renderer-binding-probe.js" },
  { entry: "src/audit-entry.ts", format: "iife", outfile: "dist/contract-audit.js" },
  { entry: "src/console-entry.ts", format: "iife", outfile: "dist/console.js" },
];

for (const { entry, format, outfile } of entries) {
  await build({
    absWorkingDir: packageRoot,
    entryPoints: [entry],
    bundle: true,
    platform: "browser",
    format,
    target: "es2024",
    define: { __CODEXHOST_PERSONAL_BUILD_VERSION__: JSON.stringify(identity.displayVersion) },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".css": "text" },
    plugins: [tailwindEsbuildPlugin()],
    outfile,
  });
}
