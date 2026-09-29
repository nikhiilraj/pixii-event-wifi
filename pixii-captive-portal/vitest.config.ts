import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            FAS_KEY: "test-fas-key-0123456789abcdef0123456789abcdef",
            FORM_SIGNING_KEY: "test-form-signing-key-0123456789abcdef",
            BOOTSTRAP_HMAC_KEY: "test-bootstrap-hmac-key-0123456789abcdef",
            PREVIEW_TEST_PASSWORD: "test-preview-password-0123456789",
            ENVIRONMENT: "test",
            TEST_MIGRATIONS: migrations
          }
        }
      };
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"]
  }
});
