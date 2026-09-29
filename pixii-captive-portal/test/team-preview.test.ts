import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const baseUrl = "https://wifi.pixii.ai";
const password = "test-preview-password-0123456789";
const testEnv = { ...env, PREVIEW_TEST_PASSWORD: password } as Env;
const authorization = `Basic ${btoa(`pixii:${password}`)}`;

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(
    new Request(`${baseUrl}${path}`, init),
    testEnv,
    createExecutionContext()
  );
}

function protectedRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authorization);
  return worker.fetch(
    new Request(`${baseUrl}${path}`, { ...init, headers }),
    testEnv,
    createExecutionContext()
  );
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
    ).bind("rtr_puli", "evt_sf", "gl-xe3000-stock-v1", "pixii-unboxed-sf-puli-01", "b".repeat(64), 1, now, now)
  ]);
});

describe("team test flow", () => {
  it("accepts a public root signup and runs the timed flow without queuing router access", async () => {
    const response = await request("/", {
      method: "POST",
      headers: { Origin: baseUrl },
      body: new URLSearchParams({
        fullName: "Public Website TEST", email: "public-test@example.com",
        phoneCountry: "US", phone: "4155550123", consent: "accepted"
      })
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("www-authenticate")).toBeNull();
    const html = await response.text();
    expect(html).toContain("Connecting");
    const registration = await env.DB.prepare("SELECT submission_source, full_name FROM registrations").first();
    expect(registration).toMatchObject({ submission_source: "public_web", full_name: "Public Website TEST" });
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM auth_queue").first()).resolves.toMatchObject({ count: 0 });
    const endpoint = JSON.parse(html.match(/const endpoint=("[^"\n]+");/)![1]!);
    expect(await (await request(endpoint)).json()).toEqual({ status: "pending" });
    const now = Date.now();
    const signed = new URL(endpoint, baseUrl);
    const adBody = { registrationId: signed.pathname.split("/").at(-1), token: signed.searchParams.get("token"), visibleMs: 0 };
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      expect((await request("/router/fas/ad/start", { method: "POST", headers: { Origin: baseUrl, "Content-Type": "application/json" }, body: JSON.stringify(adBody) })).status).toBe(200);
      clock.mockReturnValue(now + 7000);
      expect((await request("/router/fas/ad/complete", { method: "POST", headers: { Origin: baseUrl, "Content-Type": "application/json" }, body: JSON.stringify({ ...adBody, visibleMs: 7000 }) })).status).toBe(200);
      expect(await (await request(endpoint)).json()).toEqual({ status: "connected" });
    } finally {
      vi.restoreAllMocks();
    }
    expect((await request("/preview/data")).status).toBe(401);
    const data = await protectedRequest("/preview/data");
    expect(await data.text()).toContain("public_web");
  });

  it.each([
    { origin: baseUrl, consent: "", status: 400 },
    { origin: "https://malicious.example", consent: "accepted", status: 403 }
  ])("rejects invalid public signup: $status", async ({ origin, consent, status }) => {
    const response = await request("/", {
      method: "POST", headers: { Origin: origin },
      body: new URLSearchParams({
        fullName: "Public Website TEST", email: "public-test@example.com",
        phoneCountry: "US", phone: "4155550123", consent
      })
    });
    expect(response.status).toBe(status);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first()).resolves.toMatchObject({ count: 0 });
  });

  it("serves the test form without a password while protecting the data view", async () => {
    const form = await request("/preview/test");
    expect(form.status).toBe(200);
    expect(form.headers.get("www-authenticate")).toBeNull();

    const data = await request("/preview/data");
    expect(data.status).toBe(401);
    expect(data.headers.get("www-authenticate")).toBe('Basic realm="Pixii team test", charset="UTF-8"');
  });

  it("renders a password-free test form that writes nowhere on GET", async () => {
    const response = await request("/preview/test");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(html).toContain('action="/preview/test"');
    expect(html).not.toContain('name="csrf"');
    expect(html).toContain('name="phoneCountry"');
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first())
      .resolves.toMatchObject({ count: 0 });
  });

  it("stores a clearly marked test registration in the real registrations table without queuing Wi-Fi", async () => {
    const body = new URLSearchParams({
      fullName: "Nikhil TEST",
      email: "nikhil+wifi-test@pixii.ai",
      phoneCountry: "GB",
      phone: "020 7183 8750",
      consent: "accepted"
    });
    const response = await request("/preview/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": baseUrl
      },
      body
    });
    const html = await response.text();
    const registration = await env.DB.prepare(
      "SELECT full_name, email, phone_country, phone_e164, submission_source, authorization_status FROM registrations"
    ).first<Record<string, unknown>>();
    const queue = await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_queue").first<{ count: number }>();

    expect(response.status).toBe(201);
    expect(html).toContain("Connecting");
    expect(html).toContain("You’re online");
    expect(registration).toMatchObject({
      full_name: "Nikhil TEST",
      email: "nikhil+wifi-test@pixii.ai",
      phone_country: "GB",
      phone_e164: "+442071838750",
      submission_source: "team_test",
      authorization_status: "acknowledged"
    });
    expect(queue?.count).toBe(0);
  });

  it("rejects invalid test data without inserting a registration", async () => {
    const body = new URLSearchParams({
      fullName: "X",
      email: "bad",
      phoneCountry: "US",
      phone: "123",
      consent: "accepted"
    });
    const response = await request("/preview/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": baseUrl
      },
      body
    });

    expect(response.status).toBe(400);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first())
      .resolves.toMatchObject({ count: 0 });
  });

  it("rejects a cross-origin POST without inserting a registration", async () => {
    const body = new URLSearchParams({
      fullName: "Cross Site TEST",
      email: "cross-site-test@example.com",
      phoneCountry: "US",
      phone: "415-555-0123",
      consent: "accepted"
    });
    const response = await request("/preview/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://malicious.example"
      },
      body
    });

    expect(response.status).toBe(403);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first())
      .resolves.toMatchObject({ count: 0 });
  });

  it("rejects a POST without a browser origin", async () => {
    const response = await request("/preview/test", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        fullName: "Missing Origin TEST",
        email: "missing-origin-test@example.com",
        phoneCountry: "US",
        phone: "415-555-0123",
        consent: "accepted"
      })
    });
    expect(response.status).toBe(403);
    await expect(env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first())
      .resolves.toMatchObject({ count: 0 });
  });

  it("shows both test and real Wi-Fi records in the protected backend view", async () => {
    const insert = env.DB.prepare(
      `INSERT INTO registrations (
        id, event_id, router_id, full_name, email, email_normalized, phone_country, phone_e164,
        consent_email_marketing, consent_version, consent_text, consented_at, created_at,
        authorization_status, form_idempotency_key, submission_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`
    );
    await env.DB.batch([
      insert.bind(
        "test-id", "evt_sf", "rtr_puli", "Nikhil TEST", "nikhil+wifi-test@pixii.ai",
        "nikhil+wifi-test@pixii.ai", "US", "+14155550123", "v1", "consent",
        "2026-09-24T00:00:00Z", "2026-09-24T00:00:00Z", "acknowledged", "test-idem", "team_test"
      ),
      insert.bind(
        "wifi-id", "evt_sf", "rtr_puli", "Monte WIFI", "monte+wifi@pixii.ai",
        "monte+wifi@pixii.ai", "US", "+14155550124", "v1", "consent",
        "2026-09-24T00:01:00Z", "2026-09-24T00:01:00Z", "pending", "wifi-idem", "wifi"
      )
    ]);

    const response = await protectedRequest("/preview/data");
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("Nikhil TEST");
    expect(html).toContain("nikhil+wifi-test@pixii.ai");
    expect(html).toContain("+14155550123");
    expect(html).toContain("team_test");
    expect(html).toContain("Monte WIFI");
    expect(html).toContain("monte+wifi@pixii.ai");
    expect(html).toContain("wifi");
    expect(html).toContain("pending");
    expect(html).toContain("acknowledged");
  });
});

describe("public result previews", () => {
  it.each([
    ["/preview/connecting", "Connecting"],
    ["/preview/connected", "You’re online"]
  ])("serves %s without credentials", async (path, copy) => {
    const response = await worker.fetch(
      new Request(`${baseUrl}${path}`),
      testEnv,
      createExecutionContext()
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(copy);
  });
});
