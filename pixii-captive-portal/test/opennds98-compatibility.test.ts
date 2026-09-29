// Regression coverage for the emailed router report: real handlers, local D1,
// synthetic identities and test keys only. No physical-router claim.
import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import vector from "./fixtures/opennds-level3-v10.3.json";

const testEnv: Env = { ...env, FAS_KEY: vector.key } as Env;
const domain = "https://wifi.pixii.ai";
const fetchWorker = (request: Request) => worker.fetch(request, testEnv, createExecutionContext());
// Field order and trailing separator from openNDS v9.8.0 http_microhttpd.c:1338.
const upstreamPlaintext = `hid=${vector.fields.hid}, clientip=192.168.9.100, clientmac=02:00:00:00:00:01, client_type=cpd_can, gatewayname=${vector.fields.gatewayname}, gatewayurl=http%3A%2F%2F192.168.9.1, version=9.8.0, gatewayaddress=192.168.9.1:2050, gatewaymac=02:00:00:00:00:02, authdir=opennds_auth, originurl=http%3A%2F%2Fexample.com%2F, clientif=ra1, themespec=, `;

afterEach(() => vi.useRealTimers());

beforeEach(async () => {
  await env.DB.batch([
    ...["auth_queue", "registrations", "bootstrap_tokens", "routers", "events"].map(table => env.DB.prepare(`DELETE FROM ${table}`))
  ]);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO events (id,slug,display_name,timezone,starts_at,ends_at,retention_days,created_at) VALUES ('evt_sf','email-diagnosis','Local diagnosis','America/Los_Angeles',?,'2027-01-01T00:00:00Z',365,?)").bind(now, now),
    env.DB.prepare("INSERT INTO routers (id,event_id,profile_id,gateway_name,gateway_hash,enabled,created_at,updated_at) VALUES ('rtr_puli','evt_sf','gl-xe3000-stock-v1',?,?,1,?,?)").bind(vector.fields.gatewayname, vector.gatewayHash, now, now)
  ]);
});

async function authmon(action: string, hash: string, text: string) {
  const payload = btoa(text);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(testEnv.FAS_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${action}\n${hash}\n${payload}`))), value => value.toString(16).padStart(2,"0")).join("");
  return fetchWorker(new Request(`${domain}/router/fas`, { method: "POST", body: new URLSearchParams({ auth_get: action, gatewayhash: hash, payload, signature }) }));
}

const health = (hash: string) => authmon("custom", hash, "health");

async function page(plaintext: string, queryHash?: string) {
  const keyBytes = new Uint8Array(32);
  keyBytes.set(new TextEncoder().encode(vector.key).subarray(0,32));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt"]);
  const bytes = await crypto.subtle.encrypt({ name: "AES-CBC", iv: new TextEncoder().encode(vector.iv) }, key, new TextEncoder().encode(plaintext));
  const fas = btoa(btoa(String.fromCharCode(...new Uint8Array(bytes))));
  const url = new URL("/router/fas", domain);
  url.searchParams.set("fas", fas); url.searchParams.set("iv", vector.iv);
  if (queryHash) url.searchParams.set("gatewayhash", queryHash);
  return fetchWorker(new Request(url));
}

it("control: signed full-length router ID is acknowledged", async () => {
  const response = await health(vector.gatewayHash);
  expect(response.status).toBe(200); expect(await response.text()).toBe("ack");
});

it("reported compatibility: signed 32-character router ID should resolve to this router", async () => {
  const response = await health(vector.gatewayHash.slice(0,32));
  expect(response.status).toBe(200); expect(await response.text()).toBe("ack");
});

it("counterexample: a short query hash does not stop an otherwise-valid signup page", async () => {
  const response = await page(vector.plaintext, vector.gatewayHash.slice(0,32));
  expect(response.status).toBe(200); expect(await response.text()).toContain("<form");
});

it("accepts upstream 9.8 metadata, an empty optional themespec, and the trailing separator", async () => {
  const response = await page(upstreamPlaintext);
  expect(response.status).toBe(200); expect(await response.text()).toContain("<form");
});

it.each([
  ["gatewayurl", "http%3A%2F%2F192.168.9.1"],
  ["version", "9.8.0"],
  ["authdir", "opennds_auth"],
  ["themespec", "none"]
])("isolated upstream metadata field %s should not block signup", async (field, value) => {
  const response = await page(`${vector.plaintext}, ${field}=${value}`);
  expect(response.status).toBe(200);
});

it("an upstream trailing separator with no configured custom values should not block signup", async () => {
  const response = await page(`${vector.plaintext}, `);
  expect(response.status).toBe(200);
});

it.each([
  [vector.gatewayHash, ""],
  [vector.gatewayHash.slice(0, 32), ""],
  [vector.gatewayHash, "(null)(null)(null)(null)"],
  [vector.gatewayHash.slice(0, 32), "(null)(null)(null)(null)"]
])(
  "saves a real FAS signup, holds it seven seconds, then unlocks only after signed ACK (case %#)",
  async (pollHash, customSuffix) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.now();
    const response = await page(upstreamPlaintext + customSuffix, vector.gatewayHash.slice(0, 32));
    expect(response.status).toBe(200);
    const html = await response.text();
    const hidden = (name: string) => {
      const value = html.match(new RegExp(`name="${name}" value="([^"]*)"`))?.[1];
      if (value === undefined) throw new Error(`missing ${name}`);
      return value.replaceAll("&amp;", "&").replaceAll("&quot;", '"');
    };
    const body = new URLSearchParams({
      fas: hidden("fas"), iv: hidden("iv"), state: hidden("state"),
      fullName: "Router Compatibility TEST", email: "Router-Test@Example.com",
      phoneCountry: "US", phone: "4155550123"
    });
    const submit = () => fetchWorker(new Request(`${domain}/router/fas/submit`, { method: "POST", body }));
    expect((await submit()).status).toBe(400); // Consent still mandatory.
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first()).toEqual({ count: 0 });
    body.set("consent", "accepted");
    const submitted = await submit();
    expect(submitted.status).toBe(202);
    const waiting = await submitted.text();
    const endpoint = JSON.parse(waiting.match(/const endpoint=("[^"\n]+");/)![1]!) as string;
    const statusUrl = new URL(endpoint, domain);
    const registrationId = statusUrl.pathname.split("/").at(-1)!;
    const status = async () => (await fetchWorker(new Request(statusUrl))).json();
    const ad = (action: string, visibleMs: number) => fetchWorker(new Request(`${domain}/router/fas/ad/${action}`, {
      method: "POST", headers: { Origin: domain, "Content-Type": "application/json" },
      body: JSON.stringify({ registrationId, token: statusUrl.searchParams.get("token"), visibleMs })
    }));
    expect(await env.DB.prepare("SELECT full_name, email_normalized, phone_e164, consent_email_marketing, submission_source, router_id FROM registrations").first()).toEqual({
      full_name: "Router Compatibility TEST", email_normalized: "router-test@example.com",
      phone_e164: "+14155550123", consent_email_marketing: 1, submission_source: "wifi", router_id: "rtr_puli"
    });
    expect(await env.DB.prepare("SELECT gateway_hash, rhid, state FROM auth_queue").first()).toEqual({
      gateway_hash: vector.gatewayHash, rhid: vector.rhid, state: "pending"
    });
    expect((await submit()).status).toBe(202); // A retry must not duplicate the lead.
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first()).toEqual({ count: 1 });
    expect((await ad("start", 0)).status).toBe(200);
    vi.setSystemTime(startedAt + 6999);
    expect((await ad("complete", 7000)).status).toBe(425);
    expect(await (await authmon("view", pollHash, `* ${vector.rhid}`)).text()).toBe("*");
    expect(await status()).toEqual({ status: "pending" });
    vi.setSystemTime(startedAt + 7000);
    expect((await ad("complete", 6999)).status).toBe(425);
    expect((await ad("complete", 7000)).status).toBe(200);
    expect(await status()).toEqual({ status: "pending" }); // Time alone cannot claim connected.
    const expectedRecord = `${vector.rhid} 480 5000 20000 0 0 ${btoa(registrationId)}`;
    expect(await (await authmon("view", pollHash, "none")).text()).toBe(`* ${encodeURIComponent(expectedRecord)}`);
    // Full and short requests address the SAME canonical queue, never parallel queues.
    expect(await (await authmon("view", vector.gatewayHash, "none")).text()).toBe(`* ${encodeURIComponent(expectedRecord)}`);
    expect(await (await authmon("view", pollHash, `* ${vector.rhid}`)).text()).toBe("*");
    expect(await status()).toEqual({ status: "connected" });
    expect(await (await authmon("view", pollHash, `* ${vector.rhid}`)).text()).toBe("*");
    expect(await env.DB.prepare("SELECT gateway_hash, state FROM auth_queue").first()).toEqual({ gateway_hash: vector.gatewayHash, state: "acknowledged" });
    expect(await env.DB.prepare("SELECT authorization_status, ad_visible_ms, ad_completed_at FROM registrations").first()).toEqual({
      authorization_status: "acknowledged", ad_visible_ms: 7000, ad_completed_at: startedAt + 7000
    });
  }
);
