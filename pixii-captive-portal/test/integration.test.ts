import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import vector from "./fixtures/opennds-level3-v10.3.json";

const appEnv: Env = { ...(env as Env), FAS_KEY: vector.key };
const origin = "https://wifi.pixii.ai";
const bootstrapToken = "TOKEN_0123456789_INTEGRATION_ABCDEFG";

async function workerFetch(request: Request, executionEnv = appEnv): Promise<Response> {
  return worker.fetch(request, executionEnv, createExecutionContext());
}

async function hmacHex(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appEnv.BOOTSTRAP_HMAC_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function authmonSignature(action: string, gatewayHash: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appEnv.FAS_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${action}\n${gatewayHash}\n${payload}`)
  ));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hidden(html: string, name: string): string {
  const value = html.match(new RegExp(`name="${name}" value="([^"]*)"`, "u"))?.[1];
  if (value === undefined) throw new Error(`missing ${name}`);
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"');
}

async function formState(): Promise<{ state: string; fas: string; iv: string }> {
  const url = new URL("/router/fas", origin);
  url.searchParams.set("fas", vector.fas);
  url.searchParams.set("iv", vector.iv);
  const response = await workerFetch(new Request(url));
  expect(response.status).toBe(200);
  const html = await response.text();
  return { state: hidden(html, "state"), fas: hidden(html, "fas"), iv: hidden(html, "iv") };
}

function signupRequest(
  form: { state: string; fas: string; iv: string },
  consent = true
): Request {
  const body = new URLSearchParams({
    ...form,
    fullName: "Ada Lovelace",
    email: "Ada@Example.com",
    phoneCountry: "US",
    phone: "415-555-0123"
  });
  if (consent) body.set("consent", "accepted");
  return new Request(`${origin}/router/fas/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
}

async function authmon(action: string, payload: string): Promise<Response> {
  const encodedPayload = btoa(payload);
  return workerFetch(new Request(`${origin}/router/fas`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      auth_get: action,
      gatewayhash: vector.gatewayHash,
      payload: encodedPayload,
      signature: await authmonSignature(action, vector.gatewayHash, encodedPayload)
    })
  }));
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_queue"),
    env.DB.prepare("DELETE FROM registrations"),
    env.DB.prepare("DELETE FROM bootstrap_tokens"),
    env.DB.prepare("DELETE FROM routers"),
    env.DB.prepare("DELETE FROM events")
  ]);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO events (id, slug, display_name, timezone, starts_at, ends_at, retention_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("evt_sf", "amazon-unboxed-sf-2026", "Amazon Unboxed SF", "America/Los_Angeles", now, "2030-01-01T00:00:00Z", 365, now),
    env.DB.prepare(
      "INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("rtr_puli", "evt_sf", "gl-xe3000-stock-v1", vector.fields.gatewayname, vector.gatewayHash, 1, now, now),
    env.DB.prepare(
      "INSERT INTO bootstrap_tokens (token_hash, router_id, profile_id, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(await hmacHex(bootstrapToken), "rtr_puli", "gl-xe3000-stock-v1", "2030-01-01T00:00:00Z")
  ]);
});

describe("complete captive Wi-Fi flow", () => {
  it("bootstraps, captures consent, authorizes through Authmon, and reports connected", async () => {
    const bootstrap = await workerFetch(new Request(`${origin}/router/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bootstrap_token: bootstrapToken,
        installer_version: "1.0.1",
        profile_id: "gl-xe3000-stock-v1"
      })
    }));
    expect(bootstrap.status).toBe(200);
    await expect(bootstrap.json()).resolves.toMatchObject({
      gateway_name: vector.fields.gatewayname,
      ssid: "unBoxed2026 - Fast",
      fas_secure_level: 3
    });

    const form = await formState();
    const submitted = await workerFetch(signupRequest(form));
    expect(submitted.status).toBe(202);
    const waiting = await submitted.text();
    expect(waiting).toContain("Connecting");
    expect(waiting).toContain("https://www.pixii.ai/?utm_source=event_wifi&utm_medium=captive_portal&utm_campaign=amazon_unboxed_sf_2026");
    const statusPath = waiting.match(/\/router\/fas\/status\/[^"?]+\?token=[^"<]+/u)?.[0];
    expect(statusPath).toBeTruthy();

    const registration = await env.DB.prepare(
      "SELECT id, consent_email_marketing, consent_version, consent_text, consented_at FROM registrations"
    ).first<Record<string, unknown>>();
    expect(registration).toMatchObject({
      consent_email_marketing: 1,
      consent_version: "2026-09-27.v3",
      consent_text: "I agree to receive marketing communications from Pixii.ai. Unsubscribe anytime."
    });
    expect(registration?.consent_text).toContain("marketing communications from Pixii.ai");
    expect(registration?.consented_at).toMatch(/^\d{4}-\d{2}-\d{2}T/u);

    const pending = await workerFetch(new Request(new URL(statusPath!, origin)));
    await expect(pending.json()).resolves.toEqual({ status: "pending" });
    const statusUrl = new URL(statusPath!, origin);
    const adBody = { registrationId: registration?.id, token: statusUrl.searchParams.get("token"), visibleMs: 0 };
    const adPost = (action: string, visibleMs: number) => workerFetch(new Request(`${origin}/router/fas/ad/${action}`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ ...adBody, visibleMs })
    }));
    expect((await adPost("start", 0)).status).toBe(200);
    expect(await (await authmon("view", "none")).text()).toBe("*");
    // Advance the persisted start timestamp to model seven seconds without sleeping in a unit test.
    await env.DB.prepare("UPDATE registrations SET ad_started_at = ?").bind(Date.now() - 8000).run();
    expect((await adPost("complete", 7000)).status).toBe(200);
    await env.DB.prepare("UPDATE auth_queue SET available_at = '2020-01-01T00:00:00Z'").run();
    const authList = await (await authmon("view", "none")).text();
    const encodedRecord = authList.slice(2).split(" ")[0];
    const record = decodeURIComponent(encodedRecord ?? "");
    const rhid = record.split(" ")[0];
    expect(record).toContain(" 480 5000 20000 0 0 ");
    expect((await authmon("view", `* ${rhid}`)).status).toBe(200);

    const connected = await workerFetch(new Request(new URL(statusPath!, origin)));
    await expect(connected.json()).resolves.toEqual({ status: "connected" });
  });

  it("never creates access when consent is omitted", async () => {
    const response = await workerFetch(signupRequest(await formState(), false));
    expect(response.status).toBe(400);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first())
      .resolves.toMatchObject({ count: 0 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM auth_queue").first())
      .resolves.toMatchObject({ count: 0 });
  });
});

describe("hostile and racing requests", () => {
  it.each([
    ["malformed FAS", `${origin}/router/fas?fas=bad&iv=${vector.iv}`, 403],
    ["oversized FAS", `${origin}/router/fas?fas=${"A".repeat(8_193)}&iv=${vector.iv}`, 403],
    ["wrong IV", `${origin}/router/fas?fas=${encodeURIComponent(vector.fas)}&iv=short`, 403]
  ])("fails closed for %s", async (_case, url, status) => {
    expect((await workerFetch(new Request(url))).status).toBe(status);
  });

  it("rejects oversized forms, malformed bootstrap JSON, and malformed Authmon", async () => {
    const oversized = await workerFetch(new Request(`${origin}/router/fas/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `value=${"x".repeat(16_500)}`
    }));
    const malformedJson = await workerFetch(new Request(`${origin}/router/bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad"
    }));
    const malformedAuthmon = await workerFetch(new Request(`${origin}/router/fas`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ auth_get: "view", gatewayhash: vector.gatewayHash, payload: "bad" })
    }));
    expect(oversized.status).toBe(413);
    expect(malformedJson.status).toBe(400);
    expect(malformedAuthmon.status).toBe(400);
  });

  it("rejects a wrong, disabled, or unknown Authmon gateway", async () => {
    const wrongPlaintext = vector.plaintext.replace(vector.fields.gatewayname, "unknown-gateway");
    expect(wrongPlaintext).toContain("unknown-gateway");
    await env.DB.prepare("UPDATE routers SET enabled = 0").run();
    expect((await workerFetch(new Request(
      `${origin}/router/fas?fas=${encodeURIComponent(vector.fas)}&iv=${vector.iv}`
    ))).status).toBe(403);
    expect(await (await workerFetch(new Request(`${origin}/router/fas`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ auth_get: "view", gatewayhash: "f".repeat(64), payload: btoa("none") })
    }))).text()).toBe("");
  });

  it("deduplicates simultaneous form posts and permits consistent concurrent views", async () => {
    const form = await formState();
    const [first, second] = await Promise.all([
      workerFetch(signupRequest(form)),
      workerFetch(signupRequest(form))
    ]);
    expect([first.status, second.status]).toEqual([202, 202]);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first())
      .resolves.toMatchObject({ count: 1 });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM auth_queue").first())
      .resolves.toMatchObject({ count: 1 });

    await env.DB.prepare("UPDATE auth_queue SET available_at = '2020-01-01T00:00:00Z'").run();
    await env.DB.prepare("UPDATE registrations SET ad_started_at = ?, ad_completed_at = ?, ad_visible_ms = 7000").bind(Date.now() - 8000, Date.now()).run();
    const [viewOne, viewTwo] = await Promise.all([authmon("view", "none"), authmon("view", "none")]);
    expect(await viewOne.text()).toBe(await viewTwo.text());
    await expect(env.DB.prepare("SELECT state FROM auth_queue").first())
      .resolves.toMatchObject({ state: "delivered" });
  });

  it("does not revive a timed-out authorization with a late acknowledgement", async () => {
    await workerFetch(signupRequest(await formState()));
    const row = await env.DB.prepare("SELECT rhid FROM auth_queue").first<{ rhid: string }>();
    await env.DB.prepare("UPDATE auth_queue SET expires_at = '2020-01-01T00:00:00Z'").run();
    await authmon("view", `* ${row?.rhid}`);
    await expect(env.DB.prepare("SELECT state FROM auth_queue").first())
      .resolves.toMatchObject({ state: "expired" });
    await expect(env.DB.prepare("SELECT authorization_status FROM registrations").first())
      .resolves.toMatchObject({ authorization_status: "expired" });
  });

  it("fails safely when D1 is unavailable", async () => {
    const failingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") return () => { throw new Error("private D1 detail"); };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const response = await workerFetch(
      new Request(`${origin}/health`),
      { ...appEnv, DB: failingDb }
    );
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"ok":false}');
  });
});
