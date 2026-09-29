import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { D1Repository } from "../src/repository";
import type { Env } from "../src/types";

const origin = "https://wifi.pixii.ai";
const testEnv = { ...env } as Env;
const request = (path: string, init: RequestInit = {}) => worker.fetch(
  new Request(origin + path, init), testEnv, createExecutionContext()
);
let now: number;
let registrationId: string;
let token: string;
let statusUrl: string;
const post = (action: string, visibleMs = 0, overrides: Record<string, unknown> = {}, suppliedOrigin = origin) => request(
  `/router/fas/ad/${action}`, {
    method: "POST", headers: { Origin: suppliedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ registrationId, token, visibleMs, ...overrides })
  }
);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_queue"), env.DB.prepare("DELETE FROM registrations"),
    env.DB.prepare("DELETE FROM bootstrap_tokens"), env.DB.prepare("DELETE FROM routers"), env.DB.prepare("DELETE FROM events")
  ]);
  now = Date.now();
  const iso = new Date(now).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO events (id, slug, display_name, timezone, starts_at, ends_at, retention_days, created_at) VALUES ('evt_ad','ad','Ad','America/Los_Angeles',?,'2030-01-01T00:00:00Z',365,?)").bind(iso, iso),
    env.DB.prepare("INSERT INTO routers (id,event_id,profile_id,gateway_name,gateway_hash,enabled,created_at,updated_at) VALUES ('rtr_puli','evt_ad','gl-xe3000-stock-v1','pixii-unboxed-sf-puli-01',?,1,?,?)").bind("b".repeat(64), iso, iso)
  ]);
  const response = await request("/", {
    method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ fullName: "Ad Gate TEST", email: "ad-test@example.com", phoneCountry: "US", phone: "4155550123", consent: "accepted" })
  });
  expect(response.status).toBe(201);
  const html = await response.text();
  statusUrl = JSON.parse(html.match(/const endpoint=("[^"\n]+");/)![1]!);
  const parsed = new URL(statusUrl, origin);
  registrationId = decodeURIComponent(parsed.pathname.split("/").at(-1)!);
  token = parsed.searchParams.get("token")!;
  now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => vi.restoreAllMocks());

describe("seven-second ad gate", () => {
  it("starts once, persists monotonic progress, and refuses early completion", async () => {
    expect((await post("start")).status).toBe(200);
    now += 2000;
    expect(await (await post("start", 2000)).json()).toMatchObject({ visibleMs: 2000, completed: false });
    expect(await (await post("start", 1000)).json()).toMatchObject({ visibleMs: 2000 });
    expect((await post("complete", 7000)).status).toBe(425);
    now += 5000;
    expect((await post("complete", 6999)).status).toBe(425);
    expect((await post("complete", 7000)).status).toBe(200);
    const first = await env.DB.prepare("SELECT ad_started_at, ad_completed_at FROM registrations WHERE id = ?").bind(registrationId).first();
    now += 1000;
    expect((await post("complete", 7000)).status).toBe(200);
    expect(await env.DB.prepare("SELECT ad_started_at, ad_completed_at FROM registrations WHERE id = ?").bind(registrationId).first()).toEqual(first);
    expect(await (await request(statusUrl)).json()).toEqual({ status: "connected" });
  });

  it("does not start from a claimed seven seconds and never completes before start", async () => {
    expect((await post("complete", 7000)).status).toBe(425);
    expect(await (await post("start", 7000)).json()).toMatchObject({ visibleMs: 0 });
    expect((await post("complete", 7000)).status).toBe(425);
  });

  it("holds router delivery and even a premature router ACK until ad completion", async () => {
    const rhid = "a".repeat(64);
    const iso = new Date(now).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE registrations SET authorization_status = 'pending', submission_source = 'wifi' WHERE id = ?").bind(registrationId),
      env.DB.prepare("INSERT INTO auth_queue (rhid,registration_id,gateway_hash,auth_record,state,delivery_count,created_at,expires_at,available_at) VALUES (?,?,?,'router-auth-record','pending',0,?,?,?)").bind(rhid, registrationId, "b".repeat(64), iso, new Date(now + 90000).toISOString(), iso)
    ]);
    await post("start");
    now += 8000;
    const repository = new D1Repository(env.DB);
    for (const mode of ["view", "list"] as const) {
      expect((await repository.authmonPoll({ gatewayHash: "b".repeat(64), acknowledgedRhids: [rhid], mode, now: new Date(now).toISOString(), limit: 10 })).records).toEqual([]);
    }
    expect(await (await request(statusUrl)).json()).toEqual({ status: "pending" });
    expect((await post("complete", 7000)).status).toBe(200);
    expect(await (await request(statusUrl)).json()).toEqual({ status: "pending" });
    expect((await repository.authmonPoll({ gatewayHash: "b".repeat(64), acknowledgedRhids: [], mode: "view", now: new Date(now).toISOString(), limit: 10 })).records).toEqual([{ rhid, authRecord: "router-auth-record" }]);
    await repository.authmonPoll({ gatewayHash: "b".repeat(64), acknowledgedRhids: [rhid], mode: "view", now: new Date(now).toISOString(), limit: 10 });
    expect(await (await request(statusUrl)).json()).toEqual({ status: "connected" });
  });

  it("keeps acknowledged public sessions pending until the ad is complete", async () => {
    now += 20000;
    expect(await (await request(statusUrl)).json()).toEqual({ status: "pending" });
  });

  it("does not report an expired session when D1 is temporarily unavailable", async () => {
    const failingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") return () => { throw new Error("temporary database failure"); };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    for (const path of [statusUrl, statusUrl.replace("/status/", "/wait/")]) {
      const response = await worker.fetch(new Request(origin + path), { ...testEnv, DB: failingDb }, createExecutionContext());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("temporary database failure");
    }
    expect(await (await request(statusUrl)).json()).toEqual({ status: "pending" });
  });

  it("rejects wrong origin, token, registration and malformed time", async () => {
    expect((await post("start", 0, {}, "https://evil.example")).status).toBe(403);
    expect((await post("start", 0, { token: token + "tamper" })).status).toBe(403);
    expect((await post("start", 0, { registrationId: "another-registration" })).status).toBe(403);
    for (const visibleMs of [-1, 7001, 1.5, "7000"]) {
      expect((await post("start", 0, { visibleMs })).status).toBe(400);
    }
  });

  it("restores the same signed waiting page without a new registration", async () => {
    await post("start"); now += 2500;
    await post("start", 2500);
    const response = await request(statusUrl.replace("/status/", "/wait/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Electric Chengdu Street Heat");
    expect(await (await post("start")).json()).toMatchObject({ visibleMs: 2500 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first()).toEqual({ count: 1 });
  });

  it("keeps old pending sessions on the legacy release behavior", async () => {
    await env.DB.prepare("UPDATE registrations SET ad_gate_required = 0 WHERE id = ?").bind(registrationId).run();
    expect(await (await post("start")).json()).toMatchObject({ requiresGate: false });
    now += 8000;
    expect(await (await request(statusUrl)).json()).toEqual({ status: "connected" });
  });

  it("does not release an expired router session", async () => {
    const iso = new Date(now).toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE registrations SET authorization_status = 'pending' WHERE id = ?").bind(registrationId),
      env.DB.prepare("INSERT INTO auth_queue (rhid,registration_id,gateway_hash,auth_record,state,delivery_count,created_at,expires_at) VALUES (?,?,?,'expired-record','pending',0,?,?)").bind("a".repeat(64), registrationId, "b".repeat(64), iso, new Date(now + 90000).toISOString())
    ]);
    await post("start"); now += 91000;
    expect((await post("complete", 7000)).status).toBe(410);
    expect(await (await request(statusUrl)).json()).toEqual({ status: "expired" });
  });
});
