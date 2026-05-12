import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/interface.ts",
        "src/repository/file-adapter.ts",
        "src/repository/story-repository.ts",
        "src/repository/spec-repository.ts",
        "src/repository/task-repository.ts"
      ],
      reporter: ["text", "html", "json"],
      thresholds: {
        "100": true
      }
    }
  }
});
