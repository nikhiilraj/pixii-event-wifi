import { createHmac } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = path.resolve("scripts/issue-bootstrap-token.mjs");
const temporaryDirectories = [];

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "pixii-token-test-"));
  temporaryDirectories.push(directory);
  const bin = path.join(directory, "bin");
  await mkdir(bin);
  const capture = path.join(directory, "wrangler-args.txt");
  const fakeNpx = path.join(bin, "npx");
  await writeFile(fakeNpx, `#!/bin/sh\nprintf '%s\\n' "$@" > "$CAPTURE_PATH"\nexit "\${FAKE_NPX_EXIT:-0}"\n`, { mode: 0o700 });
  const secret = path.join(directory, "hmac-secret");
  const output = path.join(directory, "bootstrap-token");
  await writeFile(secret, "issuer-test-secret-0123456789abcdef", { mode: 0o600 });
  return { directory, bin, capture, secret, output };
}

function run(paths, extraEnvironment = {}) {
  return spawnSync(process.execPath, [
    script,
    "--hmac-secret-file", paths.secret,
    "--output-token-file", paths.output,
    "--router-id", "rtr_puli",
    "--profile-id", "gl-xe3000-stock-v1",
    "--expires-at", "2030-01-01T00:00:00Z",
    "--database", "pixii-event-wifi-production",
    "--remote"
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${paths.bin}:${process.env.PATH}`,
      CAPTURE_PATH: paths.capture,
      ...extraEnvironment
    }
  });
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("issue-bootstrap-token", () => {
  it("writes a mode-600 token and sends only its HMAC to Wrangler", async () => {
    const paths = await fixture();
    const result = run(paths);
    expect(result.status).toBe(0);
    const token = (await readFile(paths.output, "utf8")).trim();
    const secret = (await readFile(paths.secret, "utf8")).trim();
    const hash = createHmac("sha256", secret).update(token).digest("hex");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect((await lstat(paths.output)).mode & 0o777).toBe(0o600);
    const args = await readFile(paths.capture, "utf8");
    expect(args).toContain("wrangler\nd1\nexecute\npixii-event-wifi-production\n--remote\n--command\n");
    expect(args).toContain(hash);
    expect(args).not.toContain(token);
    expect(args).not.toContain(secret);
    expect(result.stdout).toContain(paths.output);
    expect(result.stdout).toContain(hash.slice(-8));
    expect(`${result.stdout}${result.stderr}`).not.toContain(token);
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });

  it("rejects a loose or symlinked secret file", async () => {
    const loose = await fixture();
    await chmod(loose.secret, 0o644);
    expect(run(loose).status).not.toBe(0);
    const linked = await fixture();
    const target = `${linked.secret}.target`;
    await writeFile(target, "issuer-test-secret-0123456789abcdef", { mode: 0o600 });
    await chmod(linked.secret, 0o600);
    const { unlink } = await import("node:fs/promises");
    await unlink(linked.secret);
    await symlink(target, linked.secret);
    expect(run(linked).status).not.toBe(0);
  });

  it("refuses to overwrite an existing token file", async () => {
    const paths = await fixture();
    await writeFile(paths.output, "keep-me", { mode: 0o600 });
    expect(run(paths).status).not.toBe(0);
    expect(await readFile(paths.output, "utf8")).toBe("keep-me");
  });

  it("removes the newly created token and redacts secrets when Wrangler fails", async () => {
    const paths = await fixture();
    const result = run(paths, { FAKE_NPX_EXIT: "12" });
    expect(result.status).not.toBe(0);
    await expect(readFile(paths.output, "utf8")).rejects.toThrow();
    const combined = `${result.stdout}${result.stderr}`;
    expect(combined).not.toContain("issuer-test-secret-0123456789abcdef");
  });
});
