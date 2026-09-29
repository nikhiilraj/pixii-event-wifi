import { applyD1Migrations, env, type D1Migration } from "cloudflare:test";
import { beforeAll } from "vitest";

type MigrationEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

beforeAll(async () => {
  const testEnv = env as MigrationEnv;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});
