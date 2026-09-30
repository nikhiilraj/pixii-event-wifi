import { createExecutionContext, waitOnExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import vector from "./fixtures/opennds-level3-v10.3.json";

const appEnv: Env = { ...(env as Env), FAS_KEY: vector.key, ANALYTICS_ENABLED: "true", ANALYTICS_ROLLOUT_AT: "2026-09-30T00:00:00.000Z", PRIVACY_US_REVIEWED:"true" };
const origin = "https://wifi.pixii.ai";
const bootstrapToken = "TOKEN_0123456789_INTEGRATION_ABCDEFG";

async function workerFetch(request: Request, executionEnv = appEnv): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(request,{cf:{country:"US"}}), executionEnv, ctx);
  await waitOnExecutionContext(ctx); return response;
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

async function formState(): Promise<{ state: string; fas: string; iv: string; analyticsContext: string }> {
  const url = new URL("/router/fas", origin);
  url.searchParams.set("fas", vector.fas);
  url.searchParams.set("iv", vector.iv);
  const response = await workerFetch(new Request(url));
  expect(response.status).toBe(200);
  const html = await response.text();
  return { state: hidden(html, "state"), fas: hidden(html, "fas"), iv: hidden(html, "iv"), analyticsContext: hidden(html,"analyticsContext") };
}

function signupRequest(
  form: { state: string; fas: string; iv: string; analyticsContext: string },
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
    env.DB.prepare("DELETE FROM analytics_outbox"),
    env.DB.prepare("DELETE FROM attribution_handoffs"),
    env.DB.prepare("DELETE FROM analytics_visits")
  ]);
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

describe("analytics with real signed local Authmon flow", () => {
  it.each([false,true])("deduplicates server facts after explicit signed router acknowledgement (outbox unavailable=%s)", async (outboxUnavailable) => {
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
    expect(waiting.replaceAll("&amp;", "&")).toContain("https://www.pixii.ai/?utm_source=event_wifi&utm_medium=captive_portal&utm_campaign=amazon_unboxed_sf_2026");
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
    if(outboxUnavailable) await env.DB.exec("CREATE TRIGGER fail_outbox_ack BEFORE INSERT ON analytics_outbox BEGIN SELECT RAISE(FAIL, 'synthetic analytics outage'); END;");
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
    if(outboxUnavailable) {
      expect(await env.DB.prepare("SELECT authorization_status FROM registrations").first("authorization_status")).toBe("acknowledged");
      await env.DB.exec("DROP TRIGGER fail_outbox_ack;");
    }

    const connected = await workerFetch(new Request(new URL(statusPath!, origin)));
    await expect(connected.json()).resolves.toEqual({ status: "connected", connectedUrl: "/connected" });
    const cookie = connected.headers.get("Set-Cookie");
    expect(cookie).toContain("Secure; HttpOnly; SameSite=Strict");
    const clean = await workerFetch(new Request(origin+"/connected",{headers:{Cookie:cookie!.split(";")[0]!}}));
    expect(clean.status).toBe(200);
    const html = await clean.text();
    expect(html).not.toContain(String(registration?.id));
    expect(html).not.toContain(statusUrl.searchParams.get("token")!);
    await authmon("view", `* ${rhid}`);
    await workerFetch(new Request(new URL(statusPath!, origin)));
    const rows = await env.DB.prepare("SELECT event,count(*) AS n FROM analytics_outbox GROUP BY event ORDER BY event").all();
    expect(rows.results).toEqual([{event:"wifi_connected",n:1},{event:"wifi_signup_completed",n:1}]);
    // Simulate an interrupted enqueue: durable ack/signup facts recover once.
    await env.DB.prepare("DELETE FROM analytics_outbox").run();
    await authmon("view", "none");
    expect((await env.DB.prepare("SELECT event,count(*) AS n FROM analytics_outbox GROUP BY event ORDER BY event").all()).results).toEqual(rows.results);
  });

});
