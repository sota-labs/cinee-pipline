import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.{ts,mts,cts}"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
