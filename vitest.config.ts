import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      SESSION_SECRET: "test-secret-test-secret-test-secret-123",
      DEEPSEEK_API_KEY: "test",
      APP_URL: "http://localhost:3000",
      WP_NETWORK_URL: "https://network.test",
      HASWELL_BOTS_CLIENT_SECRET: "x".repeat(40),
      DATA_DIR: ".data-test",
    },
  },
});
