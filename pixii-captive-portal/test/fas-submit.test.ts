import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import vector from "./fixtures/opennds-level3-v10.3.json";

const testEnv: Env = { ...env, FAS_KEY: vector.key } as Env;
const baseUrl = "https://wifi.pixii.ai";

async function encryptFas(plaintext: string, iv = vector.iv): Promise<string> {
  const passphrase = new TextEncoder().encode(vector.key);
  const keyBytes = new Uint8Array(32);
  keyBytes.set(passphrase.subarray(0, 32));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: new TextEncoder().encode(iv) },
    key,
    new TextEncoder().encode(plaintext)
  );
  const inner = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return btoa(inner);
}

function fasUrl(fas = vector.fas, iv = vector.iv): string {
  const url = new URL("/router/fas", baseUrl);
  url.searchParams.set("fas", fas);
  url.searchParams.set("iv", iv);
  return url.toString();
}

async function fetchWorker(request: Request, executionEnv: Env = testEnv): Promise<Response> {
  return worker.fetch(request, executionEnv, createExecutionContext());
}

function hiddenValue(html: string, name: string): string {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`, "u"));
  if (!match?.[1]) throw new Error(`Missing ${name}`);
  return match[1].replaceAll("&amp;", "&").replaceAll("&quot;", '"');
}

async function getForm(fas = vector.fas, iv = vector.iv): Promise<{
  response: Response;
  html: string;
  state: string;
}> {
  const response = await fetchWorker(new Request(fasUrl(fas, iv)));
  const html = await response.text();
  return { response, html, state: response.ok ? hiddenValue(html, "state") : "" };
}

async function submit(
  overrides: Record<string, string | undefined> = {},
  fas = vector.fas,
  iv = vector.iv,
  executionEnv: Env = testEnv
): Promise<Response> {
  const { state } = await getForm(fas, iv);
  const values: Record<string, string | undefined> = {
    fas,
    iv,
    state,
    fullName: "Ada Lovelace",
    email: "Ada@Example.com",
    phoneCountry: "US",
    phone: "415-555-0123",
    consent: "accepted",
    ...overrides
  };
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) body.set(key, value);
  }
  return fetchWorker(new Request(`${baseUrl}/router/fas/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  }), executionEnv);
}

async function counts(): Promise<{ registrations: number; queue: number }> {
  const registrations = await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations")
    .first<{ count: number }>();
  const queue = await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_queue")
    .first<{ count: number }>();
  return { registrations: registrations?.count ?? -1, queue: queue?.count ?? -1 };
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
    ).bind("evt_sf", "amazon-unboxed-sf-2026", "Amazon Unboxed SF", "America/Los_Angeles", now, "2027-01-01T00:00:00.000Z", 365, now),
    env.DB.prepare(
      "INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("rtr_puli", "evt_sf", "gl-xe3000-stock-v1", vector.fields.gatewayname, vector.gatewayHash, 1, now, now)
  ]);
});

describe("FAS page", () => {
  it("renders an actionable form only for a valid enabled gateway", async () => {
    const { response, html } = await getForm();
    expect(response.status).toBe(200);
    expect(html).toContain("Connect to Wi-Fi");
    expect(hiddenValue(html, "fas")).toBe(vector.fas);
    expect(hiddenValue(html, "iv")).toBe(vector.iv);
    expect(html).not.toContain(vector.plaintext);
  });

  it("denies an unknown gateway and a disabled gateway", async () => {
    const unknownPlaintext = vector.plaintext.replace(vector.fields.gatewayname, "unknown-gateway");
    const unknown = await getForm(await encryptFas(unknownPlaintext));
    await env.DB.prepare("UPDATE routers SET enabled = 0").run();
    const disabled = await getForm();
    expect(unknown.response.status).toBe(403);
    expect(disabled.response.status).toBe(403);
    expect(unknown.html).not.toContain("<form");
    expect(disabled.html).not.toContain("<form");
    expect(await counts()).toEqual({ registrations: 0, queue: 0 });
  });

  it.each([
    ["missing IV", new URL(`/router/fas?fas=${encodeURIComponent(vector.fas)}`, baseUrl).toString()],
    ["wrong IV", fasUrl(vector.fas, "wrong-iv")]
  ])("denies a payload with %s", async (_case, url) => {
    const response = await fetchWorker(new Request(url));
    expect(response.status).toBe(403);
    expect(await counts()).toEqual({ registrations: 0, queue: 0 });
  });
});

describe("FAS signup submission", () => {
  it("commits signup before queuing access", async () => {
    const response = await submit();
    expect(response.status).toBe(202);
    const registration = await env.DB.prepare("SELECT * FROM registrations").first<Record<string, unknown>>();
    const queue = await env.DB.prepare("SELECT * FROM auth_queue").first<Record<string, unknown>>();
    expect(registration?.consent_email_marketing).toBe(1);
    expect(registration?.consent_version).toBe("2026-09-27.v3");
    expect(registration?.consent_text).toBe(
      "I agree to receive marketing communications from Pixii.ai. Unsubscribe anytime."
    );
    expect(registration?.phone_e164).toBe("+14155550123");
    expect(queue?.registration_id).toBe(registration?.id);
    expect(
      (new Date(String(queue?.expires_at)).getTime() - new Date(String(queue?.created_at)).getTime()) / 1000
    ).toBe(90);
  });

  it.each([
    ["invalid fields", { fullName: "A", email: "bad", phone: "123" }],
    ["missing consent", { consent: undefined }]
  ])("returns field errors and inserts nothing for %s", async (_case, overrides) => {
    const response = await submit(overrides);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("error");
    expect(await counts()).toEqual({ registrations: 0, queue: 0 });
  });

  it("rejects a tampered form-state token and inserts nothing", async () => {
    const { state } = await getForm();
    const response = await submit({ state: state.slice(0, -1) + (state.endsWith("A") ? "B" : "A") });
    expect(response.status).toBe(403);
    expect(await counts()).toEqual({ registrations: 0, queue: 0 });
  });

  it("returns a generic 503 and rolls back when D1 fails", async () => {
    const { state } = await getForm();
    const failingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "batch") return async () => { throw new Error("simulated D1 failure"); };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const response = await submit({ state }, vector.fas, vector.iv, {
      ...testEnv,
      DB: failingDb
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SQL");
    const registration = await env.DB.prepare("SELECT id FROM registrations").first();
    expect(registration).toBeNull();
  });

  it("deduplicates a repeated button press", async () => {
    const { state } = await getForm();
    expect((await submit({ state })).status).toBe(202);
    expect((await submit({ state })).status).toBe(202);
    expect(await counts()).toEqual({ registrations: 1, queue: 1 });
  });

  it("allows the same email from two different devices", async () => {
    expect((await submit()).status).toBe(202);
    const secondPlaintext = vector.plaintext.replace(vector.fields.hid, "f".repeat(64));
    const secondFas = await encryptFas(secondPlaintext);
    expect((await submit({}, secondFas)).status).toBe(202);
    expect(await counts()).toEqual({ registrations: 2, queue: 2 });
  });
});

describe("authorization status", () => {
  it("keeps a quickly acknowledged connection pending until its ad is completed", async () => {
    const submitted = await submit();
    const html = await submitted.text();
    const endpoint = html.match(/\/router\/fas\/status\/[^"?]+\?token=[^"<]+/u)?.[0];
    expect(endpoint).toBeTruthy();
    await env.DB.prepare("UPDATE registrations SET authorization_status = 'acknowledged'").run();
    const early = await fetchWorker(new Request(new URL(endpoint!, baseUrl)));
    expect(await early.json()).toEqual({ status: "pending" });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7_000);
    try {
      const later = await fetchWorker(new Request(new URL(endpoint!, baseUrl)));
      expect(await later.json()).toEqual({ status: "pending" });
      await env.DB.prepare("UPDATE registrations SET ad_started_at = ?, ad_completed_at = ?, ad_visible_ms = 7000").bind(Date.now() - 7000, Date.now()).run();
      expect(await (await fetchWorker(new Request(new URL(endpoint!, baseUrl)))).json()).toEqual({ status: "connected" });
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("exposes only pending, connected, or expired for a valid signed status URL", async () => {
    const submitted = await submit();
    const html = await submitted.text();
    const endpoint = html.match(/\/router\/fas\/status\/[^"?]+\?token=[^"<]+/u)?.[0];
    expect(endpoint).toBeTruthy();

    const pending = await fetchWorker(new Request(new URL(endpoint!, baseUrl)));
    expect(await pending.json()).toEqual({ status: "pending" });
    await env.DB.prepare("UPDATE registrations SET authorization_status = 'acknowledged'").run();
    await env.DB.prepare("UPDATE registrations SET ad_started_at = ?, ad_completed_at = ?, ad_visible_ms = 7000").bind(Date.now() - 7000, Date.now()).run();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 7_000);
    const connected = await fetchWorker(new Request(new URL(endpoint!, baseUrl)));
    expect(await connected.json()).toEqual({ status: "connected" });
    vi.restoreAllMocks();
    await env.DB.prepare("UPDATE registrations SET authorization_status = 'expired'").run();
    const expired = await fetchWorker(new Request(new URL(endpoint!, baseUrl)));
    expect(await expired.json()).toEqual({ status: "expired" });
  });

  it("expires the browser status without an Authmon poll", async () => {
    const submitted = await submit();
    const html = await submitted.text();
    const endpoint = html.match(/\/router\/fas\/status\/[^"?]+\?token=[^"<]+/u)?.[0];
    expect(endpoint).toBeTruthy();
    await env.DB.prepare("UPDATE auth_queue SET expires_at = ?")
      .bind("2020-01-01T00:00:00Z").run();

    const response = await fetchWorker(new Request(new URL(endpoint!, baseUrl)));
    expect(await response.json()).toEqual({ status: "expired" });
    await expect(env.DB.prepare("SELECT state FROM auth_queue").first())
      .resolves.toMatchObject({ state: "expired" });
  });

  it("returns the same generic 404 for a bad token or unknown registration", async () => {
    const submitted = await submit();
    const html = await submitted.text();
    const endpoint = html.match(/\/router\/fas\/status\/([^"?]+)\?token=([^"<]+)/u);
    expect(endpoint).toBeTruthy();
    const badToken = await fetchWorker(new Request(`${baseUrl}/router/fas/status/${endpoint![1]}?token=bad`));
    const unknown = await fetchWorker(new Request(`${baseUrl}/router/fas/status/unknown?token=${endpoint![2]}`));
    expect(badToken.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await badToken.text()).toBe(await unknown.text());
  });
});
