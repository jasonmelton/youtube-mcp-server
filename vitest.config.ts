import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Backend MCP server: no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
