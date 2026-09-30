import { D1Repository } from "./repository";
import type { Env } from "./types";

const BATCH_SIZE = 100;
const MAX_BATCHES = 10;
const OPERATIONAL_RETENTION_MS = 30 * 24 * 60 * 60_000;

export async function runScheduled(env: Env, scheduledTime = Date.now()): Promise<void> {
  const requestId = crypto.randomUUID();
  const repository = new D1Repository(env.DB);
  const nowMs = Number.isFinite(scheduledTime) ? scheduledTime : Date.now();
  const now = new Date(nowMs).toISOString();
  const deleteBefore = new Date(nowMs - OPERATIONAL_RETENTION_MS).toISOString();
  let queuesExpired = 0;
  let queuesDeleted = 0;
  let registrationsDeleted = 0;

  try {
    // Analytics retention is independent of operational lead/auth retention.
    try { await env.DB.batch([
      env.DB.prepare("DELETE FROM attribution_handoffs WHERE expires_at <= ?").bind(nowMs),
      env.DB.prepare("DELETE FROM analytics_visits WHERE created_at < ?").bind(deleteBefore)
    ]); } catch { console.warn(JSON.stringify({ event: "wifi_analytics_cleanup_deferred" })); }
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const queues = await repository.expireOperationalRows(now, deleteBefore, BATCH_SIZE);
      const registrations = await repository.deleteExpiredRegistrations(now, BATCH_SIZE);
      queuesExpired += queues.expired;
      queuesDeleted += queues.deleted;
      registrationsDeleted += registrations;
      if (queues.expired === 0 && queues.deleted === 0 && registrations === 0) break;
    }
    console.log(JSON.stringify({
      requestId,
      outcome: "ok",
      queuesExpired,
      queuesDeleted,
      registrationsDeleted
    }));
  } catch (error) {
    console.log(JSON.stringify({
      requestId,
      outcome: "error",
      queuesExpired,
      queuesDeleted,
      registrationsDeleted
    }));
    throw error;
  }
}
