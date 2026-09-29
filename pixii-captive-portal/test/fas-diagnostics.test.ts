import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import vector from "./fixtures/opennds-level3-v10.3.json";

const testEnv: Env = { ...env, FAS_KEY: vector.key } as Env;
const domain = "https://wifi.pixii.ai";
const fetchWorker = (request: Request, bindings = testEnv) => worker.fetch(request, bindings, createExecutionContext());
const pageRequest = (fas = vector.fas, iv = vector.iv) => new Request(`${domain}/router/fas?${new URLSearchParams({ fas, iv })}`);
let warning: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  await env.DB.batch([...["auth_queue", "registrations", "bootstrap_tokens", "routers", "events"].map(table => env.DB.prepare(`DELETE FROM ${table}`))]);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO events (id,slug,display_name,timezone,starts_at,ends_at,retention_days,created_at) VALUES ('evt_diag','diagnosis','Local diagnosis','America/Los_Angeles',?,'2027-01-01T00:00:00Z',365,?)").bind(now, now),
    env.DB.prepare("INSERT INTO routers (id,event_id,profile_id,gateway_name,gateway_hash,enabled,created_at,updated_at) VALUES ('rtr_diag','evt_diag','gl-xe3000-stock-v1',?,?,1,?,?)").bind(vector.fields.gatewayname, vector.gatewayHash, now, now)
  ]);
});
afterEach(() => vi.restoreAllMocks());

async function encrypted(plaintext: string) {
  const keyBytes = new Uint8Array(32);
  keyBytes.set(new TextEncoder().encode(vector.key).subarray(0, 32));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-CBC", false, ["encrypt"]);
  const bytes = await crypto.subtle.encrypt({ name: "AES-CBC", iv: new TextEncoder().encode(vector.iv) }, key, new TextEncoder().encode(plaintext));
  return btoa(btoa(String.fromCharCode(...new Uint8Array(bytes))));
}

async function expectRejected(response: Response, stage: string, reason: string, route = "/router/fas", format?: string) {
  expect(response.status).toBe(403);
  const reference = response.headers.get("X-Pixii-Request-ID");
  expect(reference).toMatch(/^[a-f0-9-]{36}$/u);
  const html = await response.text();
  expect(html).toContain(`Reference: ${reference}`);
  expect(html).not.toContain(reason);
  if (format) expect(html).not.toContain(format);
  expect(warning).toHaveBeenCalledTimes(1);
  const raw = warning.mock.calls[0]![0];
  expect(typeof raw).toBe("string");
  expect(JSON.parse(raw as string)).toEqual({ event: "pixii_fas_rejected", reference, route, stage, reason, ...(format ? { format } : {}) });
  for (const sensitive of [vector.key, vector.fas, vector.iv, vector.fields.hid, vector.fields.gatewayname, "secret-person@example.com", "192.168.9.100", "02:00:00:00:00:01", "sensitive-error-message"]) {
    expect(raw).not.toContain(sensitive);
  }
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first()).toEqual({ count: 0 });
  expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_queue").first()).toEqual({ count: 0 });
}

it.each([
  ["?iv=0123456789abcdef", "query_fas"],
  ["?fas=secret-person%40example.com", "query_iv"],
  ["?fas=a&fas=b&iv=0123456789abcdef", "query_fas"]
])("identifies missing or duplicate query inputs without recording them (%s)", async (query, stage) => {
  await expectRejected(await fetchWorker(new Request(`${domain}/router/fas${query}`)), stage, "invalid_input");
});

it.each([
  ["secret-person@example.com", vector.iv, "outer_base64"],
  [vector.fas, "short", "iv_length"],
  [btoa("bad base64"), vector.iv, "inner_base64"],
  [btoa(btoa("short ciphertext".slice(0, 5))), vector.iv, "ciphertext_length"],
  ["A".repeat(8193), vector.iv, "payload_length"]
])("identifies a malformed hand-off (case %#)", async (fas, iv, reason) => {
  await expectRejected(await fetchWorker(pageRequest(fas, iv)), "decrypt", reason);
});

it("identifies decryption failure without printing crypto exceptions or keys", async () => {
  await expectRejected(await fetchWorker(pageRequest(), { ...testEnv, FAS_KEY: "x".repeat(64) }), "decrypt", "decrypt_failed");
});

it.each([
  [`${vector.plaintext}, secret-person@example.com=sensitive-error-message`, "unknown_field"],
  [`${vector.plaintext}, hid=${vector.fields.hid}`, "duplicate_field"],
  [`${vector.plaintext}, authdir=`, "empty_field"],
  [vector.plaintext.replace(vector.fields.hid, "short"), "hid_invalid"],
  [vector.plaintext.replace(/, gatewayname=[^,]+/u, ""), "gateway_name_invalid"]
])("identifies field-validation failures (%s)", async (plaintext, reason) => {
  await expectRejected(await fetchWorker(pageRequest(await encrypted(plaintext))), "fields", reason);
});

// These assertions fail if the diagnostic conflates null sentinels with other
// malformed fields, leaks the raw fragment, or starts accepting rejected input.
it.each([
  [", (null)", "null_suffix_1"],
  [", (null)(null)", "null_suffix_2"],
  [", (null)(null)(null)", "null_suffix_3"],
  [", (null), themespec=", "null_fragment_elsewhere"],
  [", (null)(null)(null)(null), themespec=", "null_fragment_elsewhere"],
  [", , ", "empty_fragment"],
  [", , themespec=", "empty_fragment"],
  [", =secret-person@example.com", "missing_field_name"],
  [", secret-person@example.com", "missing_equals"],
  [", (null)(null)(null)(null)(null)", "missing_equals"],
  [", (null)secret-person@example.com", "missing_equals"],
  [",  (null)", "missing_equals"],
  [", (NULL)", "missing_equals"]
])("classifies a rejected fragment without accepting or exposing it (case %#)", async (suffix, format) => {
  await expectRejected(
    await fetchWorker(pageRequest(await encrypted(vector.plaintext + suffix))),
    "fields", "field_format", "/router/fas", format
  );
});

it("still rejects invalid signed form state after accepting the confirmed null suffix", async () => {
  const plaintext = `${vector.plaintext}, gatewayurl=http%3A%2F%2F192.168.9.1, version=9.8.0, authdir=opennds_auth, themespec=, (null)(null)(null)(null)`;
  const body = new URLSearchParams({ fas: await encrypted(plaintext), iv: vector.iv, state: "unused-invalid-state", email: "secret-person@example.com", phone: "4155550123" });
  await expectRejected(await fetchWorker(new Request(`${domain}/router/fas/submit`, { method: "POST", body })), "form_state", "invalid_input", "/router/fas/submit");
});

it.each(["", ", "])("accepts the confirmed four-placeholder suffix without logging client data (trailing %j)", async (trailing) => {
  const plaintext = `${vector.plaintext}, gatewayurl=http%3A%2F%2F192.168.9.1, version=9.8.0, authdir=opennds_auth, themespec=, (null)(null)(null)(null)${trailing}`;
  const response = await fetchWorker(pageRequest(await encrypted(plaintext)));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("<form");
  expect(response.headers.get("X-Pixii-Request-ID")).toBeNull();
  expect(warning).not.toHaveBeenCalled();
});

it.each([
  ["DELETE FROM routers", "router_lookup", "router_unknown"],
  ["UPDATE routers SET enabled = 0", "router_lookup", "router_disabled"],
  [`UPDATE routers SET gateway_hash = '${"a".repeat(64)}'`, "router_identity", "router_identity_mismatch"]
])("the confirmed suffix cannot bypass router checks (%s)", async (sql, stage, reason) => {
  await env.DB.prepare(sql).run();
  await expectRejected(await fetchWorker(pageRequest(await encrypted(`${vector.plaintext}, (null)(null)(null)(null)`))), stage, reason);
});

it.each([
  ["DELETE FROM routers", "router_lookup", "router_unknown"],
  ["UPDATE routers SET enabled = 0", "router_lookup", "router_disabled"],
  [`UPDATE routers SET gateway_hash = '${"a".repeat(64)}'`, "router_identity", "router_identity_mismatch"]
])("identifies router record failures (%s)", async (sql, stage, reason) => {
  await env.DB.prepare(sql).run();
  await expectRejected(await fetchWorker(pageRequest()), stage, reason);
});

it("reports the database stage but never serializes a database exception", async () => {
  vi.spyOn(env.DB, "prepare").mockImplementationOnce(() => { throw new Error("sensitive-error-message secret-person@example.com"); });
  await expectRejected(await fetchWorker(pageRequest()), "router_lookup", "unexpected");
});

it("identifies rejected form state without recording submitted personal data", async () => {
  const body = new URLSearchParams({ fas: vector.fas, iv: vector.iv, state: "invalid-state", fullName: "Sensitive Person", email: "secret-person@example.com", phone: "4155550123", consent: "accepted" });
  await expectRejected(await fetchWorker(new Request(`${domain}/router/fas/submit`, { method: "POST", body })), "form_state", "invalid_input", "/router/fas/submit");
});

it("does not log accepted openNDS 9.8 hand-offs or add a reference to successful pages", async () => {
  const response = await fetchWorker(pageRequest(await encrypted(`${vector.plaintext}, gatewayurl=http%3A%2F%2F192.168.9.1, version=9.8.0, authdir=opennds_auth, themespec=, `)));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("<form");
  expect(response.headers.get("X-Pixii-Request-ID")).toBeNull();
  expect(warning).not.toHaveBeenCalled();
});

it("still rejects the request if logging itself fails", async () => {
  warning.mockImplementationOnce(() => { throw new Error("sink unavailable"); });
  const response = await fetchWorker(pageRequest("invalid"));
  expect(response.status).toBe(403);
  expect(await response.text()).toContain("Reference:");
});
