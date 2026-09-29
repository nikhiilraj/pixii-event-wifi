import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runScheduled } from "../src/scheduled";
import type { Env } from "../src/types";

const scheduledTime = Date.parse("2026-09-23T16:00:00Z");
const now = new Date(scheduledTime).toISOString();

async function seedDomain(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO events (id, slug, display_name, timezone, starts_at, ends_at, retention_days, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("evt_sf", "amazon-unboxed-sf-2026", "Amazon Unboxed SF", "America/Los_Angeles", now, "2026-09-24T00:00:00Z", 365, now),
    env.DB.prepare(
      "INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind("rtr_puli", "evt_sf", "gl-xe3000-stock-v1", "pixii-unboxed-sf-puli-01", "b".repeat(64), 1, now, now)
  ]);
}

async function seedRegistration(
  id: string,
  createdAt: string,
  status: "pending" | "acknowledged" | "expired" = "pending"
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO registrations (
      id, event_id, router_id, full_name, email, email_normalized, phone_e164,
      consent_email_marketing, consent_version, consent_text, consented_at,
      created_at, authorization_status, form_idempotency_key
    ) VALUES (?, 'evt_sf', 'rtr_puli', 'Guest', ?, ?, '+14155550123', 1, 'v1', 'consent', ?, ?, ?, ?)`
  ).bind(id, `${id}@example.com`, `${id}@example.com`, createdAt, createdAt, status, `idem_${id}`).run();
}

async function seedQueue(
  registrationId: string,
  state: "pending" | "acknowledged",
  createdAt: string,
  expiresAt: string
): Promise<void> {
  const rhid = registrationId.padStart(64, "0").slice(-64);
  await env.DB.prepare(
    "INSERT INTO auth_queue (rhid, registration_id, gateway_hash, auth_record, state, delivery_count, created_at, expires_at, acknowledged_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)"
  ).bind(rhid, registrationId, "b".repeat(64), `${rhid} auth`, state, createdAt, expiresAt, state === "acknowledged" ? createdAt : null).run();
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_queue"),
    env.DB.prepare("DELETE FROM registrations"),
    env.DB.prepare("DELETE FROM bootstrap_tokens"),
    env.DB.prepare("DELETE FROM routers"),
    env.DB.prepare("DELETE FROM events")
  ]);
  await seedDomain();
});

describe("scheduled retention", () => {
  it("expires queues, deletes 30-day operational rows, and applies event retention", async () => {
    await seedRegistration("current", "2026-09-23T15:59:00Z");
    await seedQueue("current", "pending", "2026-09-23T15:59:00Z", "2026-09-23T16:01:00Z");
    await seedRegistration("overdue", "2026-09-23T15:58:00Z");
    await seedQueue("overdue", "pending", "2026-09-23T15:58:00Z", "2026-09-23T15:58:29Z");
    await seedRegistration("oldqueue", "2026-08-01T00:00:00Z", "acknowledged");
    await seedQueue("oldqueue", "acknowledged", "2026-08-01T00:00:00Z", "2026-08-01T00:01:30Z");
    await seedRegistration("retain", "2025-09-24T16:00:01Z", "expired");
    await seedRegistration("delete", "2025-09-23T16:00:00Z", "expired");

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runScheduled(env as Env, scheduledTime);

    await expect(env.DB.prepare("SELECT authorization_status FROM registrations WHERE id = 'overdue'").first())
      .resolves.toMatchObject({ authorization_status: "expired" });
    await expect(env.DB.prepare("SELECT id FROM registrations WHERE id = 'delete'").first()).resolves.toBeNull();
    await expect(env.DB.prepare("SELECT id FROM registrations WHERE id = 'retain'").first()).resolves.not.toBeNull();
    await expect(env.DB.prepare("SELECT state FROM auth_queue WHERE registration_id = 'current'").first())
      .resolves.toMatchObject({ state: "pending" });
    await expect(env.DB.prepare("SELECT rhid FROM auth_queue WHERE registration_id = 'oldqueue'").first())
      .resolves.toBeNull();

    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(Object.keys(entry).sort()).toEqual([
      "outcome", "queuesDeleted", "queuesExpired", "registrationsDeleted", "requestId"
    ].sort());
    expect(entry).toMatchObject({
      outcome: "ok",
      queuesExpired: 1,
      queuesDeleted: 1,
      registrationsDeleted: 1
    });
    expect(JSON.stringify(entry)).not.toMatch(/@|Guest|rtr_puli|pixii-unboxed/iu);
    log.mockRestore();
  });

  it("is idempotent on an immediate rerun", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runScheduled(env as Env, scheduledTime);
    await runScheduled(env as Env, scheduledTime);
    const second = JSON.parse(String(log.mock.calls[1]?.[0]));
    expect(second).toMatchObject({ queuesExpired: 0, queuesDeleted: 0, registrationsDeleted: 0 });
    log.mockRestore();
  });

  it("processes at most ten batches of 100 rows", async () => {
    await env.DB.prepare(
      `WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 1001)
       INSERT INTO registrations (
         id, event_id, router_id, full_name, email, email_normalized, phone_e164,
         consent_email_marketing, consent_version, consent_text, consented_at,
         created_at, authorization_status, form_idempotency_key
       ) SELECT printf('bulk_%04d', x), 'evt_sf', 'rtr_puli', 'Guest',
         printf('bulk%04d@example.com', x), printf('bulk%04d@example.com', x),
         '+14155550123', 1, 'v1', 'consent', ?, ?, 'pending', printf('bulk_idem_%04d', x)
       FROM seq`
    ).bind(now, now).run();
    await env.DB.prepare(
      `WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 1001)
       INSERT INTO auth_queue (
         rhid, registration_id, gateway_hash, auth_record, state, delivery_count,
         created_at, expires_at, acknowledged_at
       ) SELECT printf('%064x', x), printf('bulk_%04d', x), ?, printf('%064x auth', x),
         'pending', 0, ?, '2026-09-23T15:00:00Z', NULL FROM seq`
    ).bind("b".repeat(64), now).run();

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await runScheduled(env as Env, scheduledTime);
    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_queue WHERE state = 'pending'"
    ).first<{ count: number }>();
    expect(remaining?.count).toBe(1);
    const entry = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(entry.queuesExpired).toBe(1000);
    log.mockRestore();
  });
});
