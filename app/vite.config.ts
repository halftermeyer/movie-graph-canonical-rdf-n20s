/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// One .env at the repository root, read with its plain key names.
// Everything with these prefixes ends up in the browser bundle: local demo only.
export default defineConfig({
  plugins: [react()],
  envDir: "..",
  envPrefix: ["NEO4J_", "GEMINI_"],
  server: { fs: { allow: [".."] } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
