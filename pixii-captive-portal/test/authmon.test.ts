import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { D1Repository } from "../src/repository";
import type { Env } from "../src/types";
import vector from "./fixtures/opennds-level3-v10.3.json";

const testEnv = env as Env;
const repository = new D1Repository(env.DB);
const gatewayHash = vector.gatewayHash;
const now = new Date();

async function authmon(
  authGet: string,
  payload = "none",
  hash = gatewayHash,
  contentType = "application/x-www-form-urlencoded",
  signingKey = testEnv.FAS_KEY,
  signatureHash = hash
): Promise<Response> {
  const encodedPayload = btoa(payload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${authGet}\n${signatureHash}\n${encodedPayload}`)
  )), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const body = new URLSearchParams({
    auth_get: authGet,
    gatewayhash: hash,
    payload: encodedPayload,
    signature
  });
  return worker.fetch(new Request("https://wifi.pixii.ai/router/fas", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body
  }), testEnv, createExecutionContext());
}

async function seedAuthorization(index: number, expiresAt?: string): Promise<{ rhid: string; record: string }> {
  const rhid = index.toString(16).padStart(64, "0");
  const registrationId = `reg_${index}`;
  const record = `${rhid} 480 5000 20000 0 0 ${btoa(registrationId)}`;
  const createdAt = new Date(now.getTime() + index).toISOString();
  await repository.createRegistrationAndAuthorization({
    id: registrationId,
    eventId: "evt_sf",
    routerId: "rtr_puli",
    fullName: `Guest ${index}`,
    email: `guest${index}@example.com`,
    emailNormalized: `guest${index}@example.com`,
    phoneCountry: "US",
    phoneE164: `+14155550${index.toString().padStart(3, "0")}`,
    consentEmailMarketing: true,
    consentVersion: "2026-09-23.v1",
    consentText: "I agree to receive marketing emails from Pixii.ai.",
    consentedAt: createdAt,
    createdAt,
    authorizationStatus: "pending",
    formIdempotencyKey: `idem_${index}`,
    submissionSource: "wifi"
  }, {
    rhid,
    registrationId,
    gatewayHash,
    authRecord: record,
    state: "pending",
    createdAt,
    expiresAt: expiresAt ?? new Date(now.getTime() + 60_000).toISOString()
  });
  return { rhid, record };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_queue"),
    env.DB.prepare("DELETE FROM registrations"),
    env.DB.prepare("DELETE FROM bootstrap_tokens"),
    env.DB.prepare("DELETE FROM routers"),
    env.DB.prepare("DELETE FROM events")
  ]);
  const createdAt = now.toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO events (id, slug, display_name, timezone, starts_at, ends_at, retention_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("evt_sf", "amazon-unboxed-sf-2026", "Amazon Unboxed SF", "America/Los_Angeles", createdAt, "2027-01-01T00:00:00.000Z", 365, createdAt),
    env.DB.prepare(
      "INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("rtr_puli", "evt_sf", "gl-xe3000-stock-v1", vector.fields.gatewayname, gatewayHash, 1, createdAt, createdAt)
  ]);
});

describe("Authmon list delivery", () => {
  it("views up to four records and marks them delivered", async () => {
    const seeded = await Promise.all([1, 2, 3, 4, 5].map((index) => seedAuthorization(index)));
    const response = await authmon("view");
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toBe(`* ${seeded.slice(0, 4).map(({ record }) => encodeURIComponent(record)).join(" ")}`);
    const states = await env.DB.prepare("SELECT state FROM auth_queue ORDER BY created_at").all<{ state: string }>();
    expect(states.results.map(({ state }) => state)).toEqual([
      "delivered", "delivered", "delivered", "delivered", "pending"
    ]);
  });

  it("consumes at most four list records atomically", async () => {
    const seeded = await Promise.all([1, 2, 3, 4, 5].map((index) => seedAuthorization(index)));
    const response = await authmon("list");
    expect(await response.text()).toBe(
      `* ${seeded.slice(0, 4).map(({ record }) => encodeURIComponent(record)).join(" ")}`
    );
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("acknowledged");
    expect(await repository.readAuthorizationStatus("reg_5")).toBe("pending");
  });

  it("lets concurrent view polls safely return the same unacknowledged record", async () => {
    const { record } = await seedAuthorization(1);
    const [first, second] = await Promise.all([authmon("view"), authmon("view")]);
    expect(await first.text()).toBe(`* ${encodeURIComponent(record)}`);
    expect(await second.text()).toBe(`* ${encodeURIComponent(record)}`);
    await expect(env.DB.prepare("SELECT state, delivery_count FROM auth_queue").first())
      .resolves.toMatchObject({ state: "delivered", delivery_count: 2 });
  });
});

describe("Authmon acknowledgements", () => {
  it("applies acknowledgements idempotently and returns the remaining list", async () => {
    const first = await seedAuthorization(1);
    const second = await seedAuthorization(2);
    await authmon("view");

    const acknowledged = await authmon("view", `* ${first.rhid}`);
    expect(await acknowledged.text()).toBe(`* ${encodeURIComponent(second.record)}`);
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("acknowledged");
    const repeated = await authmon("view", `* ${first.rhid}`);
    expect(await repeated.text()).toBe(`* ${encodeURIComponent(second.record)}`);
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("acknowledged");
  });

  it("never revives an expired row with a late acknowledgement", async () => {
    const expired = await seedAuthorization(1, new Date(Date.now() - 1_000).toISOString());
    const response = await authmon("view", `* ${expired.rhid}`);
    expect(await response.text()).toBe("*");
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("expired");
    await expect(env.DB.prepare("SELECT state FROM auth_queue").first())
      .resolves.toMatchObject({ state: "expired" });
  });
});

describe("Authmon control calls", () => {
  it("clears stale rows only for the authenticated gateway", async () => {
    await seedAuthorization(1);
    const response = await authmon("clear");
    expect(await response.text()).toBe("");
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("expired");
  });

  it("acknowledges deauthentication without storing its raw payload", async () => {
    const response = await authmon("deauthed", "method=idle_deauth&secret=must-not-be-stored");
    expect(await response.text()).toBe("ack");
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM registrations").first())
      .toMatchObject({ count: 0 });
  });

  it("acknowledges only the allowlisted safe custom call", async () => {
    expect(await (await authmon("custom", "health")).text()).toBe("ack");
    expect(await (await authmon("custom", "write-this-value")).text()).toBe("");
  });
});

describe("Authmon rejects invalid callers and payloads", () => {
  it.each([gatewayHash, gatewayHash.slice(0, 32)])("does not mutate the queue for an unsigned poll (%s)", async (hash) => {
    await seedAuthorization(1);
    const response = await worker.fetch(new Request("https://wifi.pixii.ai/router/fas", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        auth_get: "clear",
        gatewayhash: hash,
        payload: btoa("none")
      })
    }), testEnv, createExecutionContext());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    await expect(env.DB.prepare("SELECT state FROM auth_queue").first())
      .resolves.toMatchObject({ state: "pending" });
  });

  it.each([gatewayHash, gatewayHash.slice(0, 32)])("does not mutate the queue for a forged signature (%s)", async (hash) => {
    await seedAuthorization(1);
    const response = await authmon("clear", "none", hash, "application/x-www-form-urlencoded", "wrong-signing-key-that-is-long-enough");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    await expect(env.DB.prepare("SELECT state FROM auth_queue").first())
      .resolves.toMatchObject({ state: "pending" });
  });

  it("returns empty for an unknown or disabled gateway without changing the queue", async () => {
    await seedAuthorization(1);
    const unknown = await authmon("view", "none", "f".repeat(64));
    await env.DB.prepare("UPDATE routers SET enabled = 0").run();
    const disabled = await authmon("view");
    expect(await unknown.text()).toBe("");
    expect(await disabled.text()).toBe("");
    await expect(env.DB.prepare("SELECT state FROM auth_queue").first())
      .resolves.toMatchObject({ state: "pending" });
  });

  it.each([
    ["malformed base64", new URLSearchParams({ auth_get: "view", gatewayhash: gatewayHash, payload: "not base64!" })],
    ["unknown method", new URLSearchParams({ auth_get: "destroy", gatewayhash: gatewayHash, payload: btoa("none") })],
    ["extra field", new URLSearchParams({ auth_get: "view", gatewayhash: gatewayHash, payload: btoa("none"), extra: "x" })]
  ])("fails closed for %s", async (_case, body) => {
    const response = await worker.fetch(new Request("https://wifi.pixii.ai/router/fas", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }), testEnv, createExecutionContext());
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("");
  });

  it("rejects an oversized body before parsing", async () => {
    const response = await worker.fetch(new Request("https://wifi.pixii.ai/router/fas", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `auth_get=view&gatewayhash=${gatewayHash}&payload=${"A".repeat(8_200)}`
    }), testEnv, createExecutionContext());
    expect(response.status).toBe(413);
    expect(await response.text()).toBe("");
  });

  it("rejects a non-form content type", async () => {
    const response = await authmon("view", "none", gatewayHash, "application/json");
    expect(response.status).toBe(415);
    expect(await response.text()).toBe("");
  });
});

describe("signed short gateway aliases", () => {
  const shortHash = gatewayHash.slice(0, 32);

  it("clears only the canonical gateway queue, leaving another gateway untouched", async () => {
    await seedAuthorization(1);
    await seedAuthorization(2);
    await env.DB.prepare("UPDATE auth_queue SET gateway_hash = ? WHERE registration_id = 'reg_2'").bind("c".repeat(64)).run();
    expect((await authmon("clear", "none", shortHash)).status).toBe(200);
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("expired");
    expect(await repository.readAuthorizationStatus("reg_2")).toBe("pending");
  });

  it("supports the signed legacy list action on the canonical queue", async () => {
    const { record } = await seedAuthorization(1);
    expect(await (await authmon("list", "none", shortHash)).text()).toBe(`* ${encodeURIComponent(record)}`);
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("acknowledged");
  });

  it.each([
    [shortHash, gatewayHash], [gatewayHash, shortHash]
  ])("verifies the signature over the received ID, not its alias (%s)", async (hash, signedHash) => {
    await seedAuthorization(1);
    const response = await authmon("clear", "none", hash, "application/x-www-form-urlencoded", testEnv.FAS_KEY, signedHash);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("pending");
  });

  it("rejects unknown and disabled short identities without changing the queue", async () => {
    await seedAuthorization(1);
    const unknown = await authmon("view", "none", "f".repeat(32));
    await env.DB.prepare("UPDATE routers SET enabled = 0").run();
    const disabled = await authmon("clear", "none", shortHash);
    for (const response of [unknown, disabled]) {
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    }
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("pending");
  });

  it.each([0, 1])("rejects ambiguous prefixes even if the second router is disabled (%s)", async (enabled) => {
    const { record } = await seedAuthorization(1);
    await env.DB.prepare("INSERT INTO routers (id,event_id,profile_id,gateway_name,gateway_hash,enabled,created_at,updated_at) VALUES ('rtr_collision','evt_sf','gl-xe3000-stock-v1','collision-router',?,?,?,?)")
      .bind(shortHash + "a".repeat(32), enabled, now.toISOString(), now.toISOString()).run();
    for (const action of ["view", "list", "clear", "custom"]) {
      const response = await authmon(action, action === "custom" ? "health" : "none", shortHash);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    }
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("pending");
    // Exact identities still work, even in this synthetic collision case.
    expect(await (await authmon("view")).text()).toBe(`* ${encodeURIComponent(record)}`);
  });

  it.each(["a".repeat(31), "a".repeat(33), "a".repeat(63), "a".repeat(65), "A".repeat(32), "g".repeat(32)])(
    "rejects unsupported gateway IDs (%s)", async (hash) => {
      const response = await authmon("custom", "health", hash);
      expect(response.status).toBe(400);
      expect(await response.text()).toBe("");
    }
  );

  it("does not shorten client return hashes when acknowledging through a short gateway alias", async () => {
    const { rhid } = await seedAuthorization(1);
    const response = await authmon("view", `* ${rhid.slice(0, 32)}`, shortHash);
    expect(response.status).toBe(400);
    expect(await repository.readAuthorizationStatus("reg_1")).toBe("pending");
  });
});
