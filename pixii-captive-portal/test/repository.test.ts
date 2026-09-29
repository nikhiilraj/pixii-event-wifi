import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  D1Repository,
  type AuthorizationInsert,
  type RegistrationInsert
} from "../src/repository";

const db = env.DB;
const repository = new D1Repository(db);
const now = "2026-09-23T16:00:00Z";

const registration: RegistrationInsert = {
  id: "reg_01",
  eventId: "evt_01",
  routerId: "rtr_01",
  fullName: "Ada Lovelace",
  email: "Ada@example.com",
  emailNormalized: "ada@example.com",
  phoneCountry: "US",
  phoneE164: "+14155550123",
  consentEmailMarketing: true,
  consentVersion: "2026-09-23.v1",
  consentText: "I agree to receive marketing emails from Pixii.ai.",
  consentedAt: now,
  createdAt: now,
  authorizationStatus: "pending",
  formIdempotencyKey: "idem_01",
  submissionSource: "wifi"
};

const authorization: AuthorizationInsert = {
  rhid: "a".repeat(64),
  registrationId: registration.id,
  gatewayHash: "b".repeat(64),
  authRecord: `${"a".repeat(64)} 480 5000 20000 0 0 cmVnXzAx`,
  state: "pending",
  createdAt: now,
  expiresAt: "2026-09-23T16:01:30Z"
};

async function seedEventAndRouter(): Promise<void> {
  await db.batch([
    db.prepare(
      "INSERT INTO events (id, slug, display_name, timezone, starts_at, ends_at, retention_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("evt_01", "event-01", "Event 01", "America/Los_Angeles", now, "2026-09-24T16:00:00Z", 365, now),
    db.prepare(
      "INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("rtr_01", "evt_01", "gl-xe3000-stock-v1", "pixii-unboxed-sf-puli-01", "b".repeat(64), 1, now, now)
  ]);
}

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM auth_queue"),
    db.prepare("DELETE FROM registrations"),
    db.prepare("DELETE FROM bootstrap_tokens"),
    db.prepare("DELETE FROM routers"),
    db.prepare("DELETE FROM events")
  ]);
  await seedEventAndRouter();
});

describe("D1 migration", () => {
  it("creates all five domain tables", async () => {
    const result = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('events','routers','bootstrap_tokens','registrations','auth_queue') ORDER BY name"
    ).all<{ name: string }>();

    expect(result.results.map((row) => row.name)).toEqual([
      "auth_queue",
      "bootstrap_tokens",
      "events",
      "registrations",
      "routers"
    ]);
  });

  it("rejects a router whose event does not exist", async () => {
    await expect(db.prepare(
      "INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("rtr_bad", "evt_missing", "gl-xe3000-stock-v1", "bad-gateway", "c".repeat(64), 1, now, now).run()).rejects.toThrow();
  });

  it("rejects a registration without accepted marketing consent", async () => {
    await expect(db.prepare(
      "INSERT INTO registrations (id, event_id, router_id, full_name, email, email_normalized, phone_e164, consent_email_marketing, consent_version, consent_text, consented_at, created_at, authorization_status, form_idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("reg_bad", "evt_01", "rtr_01", "Ada Lovelace", "ada@example.com", "ada@example.com", "+14155550123", 0, "v1", "declined", now, now, "pending", "idem_bad").run()).rejects.toThrow();
  });
});

describe("D1Repository.createRegistrationAndAuthorization", () => {
  it("withholds a scheduled unlock until its backend release time", async () => {
    await repository.createRegistrationAndAuthorization(registration, {
      ...authorization,
      availableAt: "2026-09-23T16:00:06Z"
    });
    const early = await repository.authmonPoll({ gatewayHash: authorization.gatewayHash, acknowledgedRhids: [], mode: "view", now: "2026-09-23T16:00:05Z", limit: 10 });
    expect(early.records).toEqual([]);
    const ready = await repository.authmonPoll({ gatewayHash: authorization.gatewayHash, acknowledgedRhids: [], mode: "view", now: "2026-09-23T16:00:06Z", limit: 10 });
    expect(ready.records).toHaveLength(1);
  });
  it("atomically creates the registration and authorization", async () => {
    const result = await repository.createRegistrationAndAuthorization(registration, authorization);

    expect(result).toMatchObject({ id: "reg_01", created: true });
    expect(await db.prepare("SELECT registration_id FROM auth_queue WHERE rhid = ?").bind(authorization.rhid).first())
      .toMatchObject({ registration_id: "reg_01" });
  });

  it("returns the original registration for a repeated idempotency key", async () => {
    await repository.createRegistrationAndAuthorization(registration, authorization);
    const repeated = await repository.createRegistrationAndAuthorization(
      { ...registration, id: "reg_02" },
      { ...authorization, rhid: "c".repeat(64), registrationId: "reg_02" }
    );

    expect(repeated).toMatchObject({ id: "reg_01", created: false });
    expect((await db.prepare("SELECT COUNT(*) AS count FROM registrations").first<{ count: number }>())?.count).toBe(1);
    expect((await db.prepare("SELECT COUNT(*) AS count FROM auth_queue").first<{ count: number }>())?.count).toBe(1);
  });

  it("never leaves a registration without its authorization row", async () => {
    const invalidQueue = { ...authorization, rhid: "too-short" };
    await expect(repository.createRegistrationAndAuthorization(registration, invalidQueue)).rejects.toThrow();

    const row = await db.prepare("SELECT id FROM registrations WHERE id = ?").bind(registration.id).first();
    expect(row).toBeNull();
  });
});

describe("D1Repository lookups", () => {
  it("returns the enabled router by its exact gateway name", async () => {
    await expect(repository.findRouterByGatewayName("pixii-unboxed-sf-puli-01"))
      .resolves.toMatchObject({
        id: "rtr_01",
        eventId: "evt_01",
        profileId: "gl-xe3000-stock-v1",
        gatewayHash: "b".repeat(64),
        enabled: true
      });
  });

  it("returns null for a gateway name that is not registered", async () => {
    await expect(repository.findRouterByGatewayName("unknown-gateway")).resolves.toBeNull();
  });

  it("reads the browser-safe authorization state", async () => {
    await repository.createRegistrationAndAuthorization(registration, authorization);

    await expect(repository.readAuthorizationStatus("reg_01", now)).resolves.toBe("pending");
    await expect(repository.readAuthorizationStatus("reg_missing", now)).resolves.toBeNull();
  });

  it("expires an overdue authorization when the browser checks status", async () => {
    await repository.createRegistrationAndAuthorization(registration, authorization);

    await expect(repository.readAuthorizationStatus("reg_01", "2026-09-23T16:01:31Z"))
      .resolves.toBe("expired");
    await expect(db.prepare("SELECT state FROM auth_queue WHERE registration_id = ?")
      .bind("reg_01").first()).resolves.toMatchObject({ state: "expired" });
  });
});

describe("D1Repository.exchangeBootstrapToken", () => {
  it("allows one initial exchange, one bounded retry, and no third exchange", async () => {
    const tokenHash = "d".repeat(64);
    await db.prepare(
      "INSERT INTO bootstrap_tokens (token_hash, router_id, profile_id, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(tokenHash, "rtr_01", "gl-xe3000-stock-v1", "2026-09-23T17:00:00Z").run();

    const first = await repository.exchangeBootstrapToken({
      tokenHash,
      profileId: "gl-xe3000-stock-v1",
      now: "2026-09-23T16:00:00Z",
      retryWindowStart: "2026-09-23T15:50:00Z"
    });
    const second = await repository.exchangeBootstrapToken({
      tokenHash,
      profileId: "gl-xe3000-stock-v1",
      now: "2026-09-23T16:05:00Z",
      retryWindowStart: "2026-09-23T15:55:00Z"
    });
    const third = await repository.exchangeBootstrapToken({
      tokenHash,
      profileId: "gl-xe3000-stock-v1",
      now: "2026-09-23T16:06:00Z",
      retryWindowStart: "2026-09-23T15:56:00Z"
    });

    expect(first).toMatchObject({ status: "ok", exchangeCount: 1, router: { id: "rtr_01" } });
    expect(second).toMatchObject({ status: "ok", exchangeCount: 2, router: { id: "rtr_01" } });
    expect(third).toEqual({ status: "exhausted" });
  });

  it("does not consume a token for a mismatched profile", async () => {
    const tokenHash = "e".repeat(64);
    await db.prepare(
      "INSERT INTO bootstrap_tokens (token_hash, router_id, profile_id, expires_at) VALUES (?, ?, ?, ?)"
    ).bind(tokenHash, "rtr_01", "gl-xe3000-stock-v1", "2026-09-23T17:00:00Z").run();

    await expect(repository.exchangeBootstrapToken({
      tokenHash,
      profileId: "wrong-profile",
      now: "2026-09-23T16:00:00Z",
      retryWindowStart: "2026-09-23T15:50:00Z"
    })).resolves.toEqual({ status: "profile_mismatch" });
    await expect(db.prepare(
      "SELECT exchange_count FROM bootstrap_tokens WHERE token_hash = ?"
    ).bind(tokenHash).first()).resolves.toMatchObject({ exchange_count: 0 });
  });
});

describe("D1Repository auth queue and retention", () => {
  it("delivers a pending record and acknowledges it idempotently", async () => {
    await repository.createRegistrationAndAuthorization(registration, authorization);

    const delivered = await repository.authmonPoll({
      gatewayHash: authorization.gatewayHash,
      mode: "view",
      acknowledgedRhids: [],
      now,
      limit: 4
    });
    const acknowledged = await repository.authmonPoll({
      gatewayHash: authorization.gatewayHash,
      mode: "view",
      acknowledgedRhids: [authorization.rhid, authorization.rhid],
      now: "2026-09-23T16:00:05Z",
      limit: 4
    });

    expect(delivered.records).toEqual([{
      rhid: authorization.rhid,
      authRecord: authorization.authRecord
    }]);
    expect(acknowledged.records).toEqual([]);
    expect(await repository.readAuthorizationStatus(registration.id)).toBe("acknowledged");
    await expect(db.prepare("SELECT state, delivery_count FROM auth_queue WHERE rhid = ?")
      .bind(authorization.rhid).first()).resolves.toMatchObject({
      state: "acknowledged",
      delivery_count: 1
    });
  });

  it("expires overdue queue rows and deletes registrations past event retention", async () => {
    await repository.createRegistrationAndAuthorization(
      { ...registration, createdAt: "2025-09-20T00:00:00Z" },
      { ...authorization, createdAt: "2025-09-20T00:00:00Z", expiresAt: "2025-09-20T00:01:30Z" }
    );

    const operational = await repository.expireOperationalRows(
      "2026-09-23T16:00:00Z",
      "2026-08-24T16:00:00Z",
      100
    );
    const registrationsDeleted = await repository.deleteExpiredRegistrations(
      "2026-09-23T16:00:00Z",
      100
    );

    expect(operational).toEqual({ expired: 1, deleted: 1 });
    expect(registrationsDeleted).toBe(1);
    await expect(db.prepare("SELECT id FROM registrations WHERE id = ?")
      .bind(registration.id).first()).resolves.toBeNull();
  });
});
