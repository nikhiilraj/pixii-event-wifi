import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const testEnv = env as Env;
const bootstrapUrl = "https://wifi.pixii.ai/router/bootstrap";
const rawToken = "TOKEN_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const expiresAt = "2030-01-01T00:00:00Z";
const expectedKeys = [
  "data_quota_kb", "download_kbps", "expires_at", "fas_key", "fas_path",
  "fas_port", "fas_secure_level", "fas_url", "gateway_name", "idle_minutes",
  "portal_hostname", "profile_version", "session_minutes", "ssid", "upload_kbps"
].sort();

async function hmacHex(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(testEnv.BOOTSTRAP_HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function bootstrap(
  token = rawToken,
  overrides: Record<string, unknown> = {},
  contentType = "application/json",
  executionEnv: Env = testEnv
): Promise<Response> {
  return worker.fetch(new Request(bootstrapUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify({
      bootstrap_token: token,
      installer_version: "1.0.1",
      profile_id: "gl-xe3000-stock-v1",
      ...overrides
    })
  }), executionEnv, createExecutionContext());
}

async function seedToken(options: { expired?: boolean; disabled?: boolean } = {}): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO events (id, slug, display_name, timezone, starts_at, ends_at, retention_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("evt_sf", "amazon-unboxed-sf-2026", "Amazon Unboxed SF", "America/Los_Angeles", now, expiresAt, 365, now),
    env.DB.prepare(
      "INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("rtr_puli", "evt_sf", "gl-xe3000-stock-v1", "pixii-unboxed-sf-puli-01", "b".repeat(64), options.disabled ? 0 : 1, now, now),
    env.DB.prepare(
      "INSERT INTO bootstrap_tokens (token_hash, router_id, profile_id, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(await hmacHex(rawToken), "rtr_puli", "gl-xe3000-stock-v1", options.expired ? "2020-01-01T00:00:00Z" : expiresAt)
  ]);
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_queue"),
    env.DB.prepare("DELETE FROM registrations"),
    env.DB.prepare("DELETE FROM bootstrap_tokens"),
    env.DB.prepare("DELETE FROM routers"),
    env.DB.prepare("DELETE FROM events")
  ]);
});

describe("router bootstrap exchange", () => {
  it("returns the exact production contract on the first exchange", async () => {
    await seedToken();
    const response = await bootstrap();
    expect(response.status).toBe(200);
    const body = await response.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(expectedKeys);
    expect(body).toEqual({
      data_quota_kb: 0,
      download_kbps: 20000,
      expires_at: expiresAt,
      fas_key: testEnv.FAS_KEY,
      fas_path: "/router/fas",
      fas_port: 443,
      fas_secure_level: 3,
      fas_url: "https://wifi.pixii.ai/router/fas",
      gateway_name: "pixii-unboxed-sf-puli-01",
      idle_minutes: 30,
      portal_hostname: "wifi.pixii.ai",
      profile_version: "gl-xe3000-stock-v1",
      session_minutes: 480,
      ssid: "unBoxed2026 - Fast",
      upload_kbps: 5000
    });
  });

  it("returns an identical bounded retry and rejects a third exchange", async () => {
    await seedToken();
    const first = await bootstrap();
    const second = await bootstrap();
    const third = await bootstrap();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(await first.text());
    expect(third.status).toBe(409);
    expect(await third.text()).not.toContain(rawToken);
  });

  it("resolves simultaneous first exchanges without issuing more than two responses", async () => {
    await seedToken();
    const [first, second] = await Promise.all([bootstrap(), bootstrap()]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await second.text()).toBe(await first.text());
    expect(await bootstrap()).toMatchObject({ status: 409 });
    await expect(env.DB.prepare("SELECT exchange_count FROM bootstrap_tokens").first())
      .resolves.toMatchObject({ exchange_count: 2 });
  });

  it.each([
    ["expired token", { expired: true, disabled: false }],
    ["disabled router", { expired: false, disabled: true }]
  ])("denies an %s without returning secrets", async (_case, options) => {
    await seedToken(options);
    const response = await bootstrap();
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).not.toContain(rawToken);
    expect(body).not.toContain(testEnv.FAS_KEY);
  });

  it("does not consume a token for the wrong profile", async () => {
    await seedToken();
    const response = await bootstrap(rawToken, { profile_id: "wrong-profile" });
    expect(response.status).toBe(400);
    await expect(env.DB.prepare("SELECT exchange_count FROM bootstrap_tokens").first())
      .resolves.toMatchObject({ exchange_count: 0 });
  });

  it("does not consume a token when the response secret is invalid", async () => {
    await seedToken();
    const response = await bootstrap(rawToken, {}, "application/json", {
      ...testEnv,
      FAS_KEY: "invalid"
    });
    expect(response.status).toBe(503);
    await expect(env.DB.prepare("SELECT exchange_count FROM bootstrap_tokens").first())
      .resolves.toMatchObject({ exchange_count: 0 });
  });

  it.each([
    "2030-01-01T00:00:00.123Z",
    "2030-02-30T00:00:00Z",
    "2030-99-99T00:00:00Z"
  ])("does not consume a token for an installer-incompatible expiry %s", async (expiry) => {
    await seedToken();
    await env.DB.prepare("UPDATE bootstrap_tokens SET expires_at = ?").bind(expiry).run();
    expect((await bootstrap()).status).toBe(503);
    await expect(env.DB.prepare("SELECT exchange_count FROM bootstrap_tokens").first())
      .resolves.toMatchObject({ exchange_count: 0 });
  });
});

describe("bootstrap input boundary", () => {
  it.each([
    ["wrong content type", () => bootstrap(rawToken, {}, "text/plain"), 415],
    ["malformed installer", () => bootstrap(rawToken, { installer_version: "v1" }), 400],
    ["unknown field", () => bootstrap(rawToken, { extra: true }), 400],
    ["malformed token", () => bootstrap("short"), 400]
  ])("rejects %s", async (_case, makeRequest, status) => {
    const response = await makeRequest();
    expect(response.status).toBe(status);
  });

  it("rejects malformed JSON and a body over 4 KiB", async () => {
    const malformed = await worker.fetch(new Request(bootstrapUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json"
    }), testEnv, createExecutionContext());
    const oversized = await worker.fetch(new Request(bootstrapUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(4_096) })
    }), testEnv, createExecutionContext());
    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
  });

  it("never logs or returns the raw token or FAS key", async () => {
    await seedToken();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await bootstrap("TOKEN_0123456789_NOT_IN_DATABASE_ABCDEFG");
    const output = `${await response.text()} ${JSON.stringify(log.mock.calls)} ${JSON.stringify(warn.mock.calls)} ${JSON.stringify(error.mock.calls)}`;
    expect(output).not.toContain("TOKEN_0123456789_NOT_IN_DATABASE_ABCDEFG");
    expect(output).not.toContain(testEnv.FAS_KEY);
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});
