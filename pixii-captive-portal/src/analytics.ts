import type { Env, HandlerContext } from "./types";
import type { SubmissionSource } from "./repository";
import { constantTimeEqual, decodeBase64UrlStrict, encodeBase64Url, hmacSha256, utf8Bytes } from "./crypto";

export type WifiEvent = "wifi_form_viewed" | "wifi_signup_completed" | "wifi_connected" | "wifi_pixii_open_requested";
export interface Visit { id: string; attribution_id: string; source: "wifi" | "public_web"; created_at: string; suppressed: number; expires_at: number }
export interface PageContext { kind: "form" | "connected"; visit: string; source: "wifi" | "public_web"; expires: number }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const TTL = 10 * 60_000;

// Optional analytics may finish after this deadline; its failure/result cannot
// hold up the operational response. All rejected promises remain handled.
export async function optionalAnalytics<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work.catch(() => fallback), new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), 300); })]); }
  finally { clearTimeout(timer); }
}

export async function analyticsRateAllowed(request: Request, env: Env): Promise<boolean> {
  if (!env.ANALYTICS_LIMIT) return env.ENVIRONMENT === "test";
  const key = encodeBase64Url(await hmacSha256(utf8Bytes(`analytics:${new Date().toISOString().slice(0,10)}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`), env.FORM_SIGNING_KEY));
  return (await env.ANALYTICS_LIMIT.limit({ key })).success;
}

export function analyticsEnabled(env: Env): boolean {
  const floor = Date.parse(env.ANALYTICS_ROLLOUT_AT ?? "");
  return env.ANALYTICS_ENABLED === "true" && Number.isFinite(floor) && floor <= Date.now();
}

export function optedOut(request: Request): boolean {
  return request.headers.get("Sec-GPC") === "1" || /(?:^|;\s*)pixii_tracking_opt_out=1(?:;|$)/u.test(request.headers.get("Cookie") ?? "");
}

// No marketing-checkbox inference. Until another jurisdiction's permission
// mechanism is approved, unknown/non-US locations fail closed.
export function trackingAllowed(request: Request, env: Env): boolean {
  return analyticsEnabled(env) && env.PRIVACY_US_REVIEWED === "true" && request.cf?.country === "US" && !optedOut(request);
}

export async function signContext(value: object, env: Env): Promise<string> {
  const data = utf8Bytes(JSON.stringify(value));
  return encodeBase64Url(data) + "." + encodeBase64Url(await hmacSha256(data, env.FORM_SIGNING_KEY));
}

export async function readContext(token: string, env: Env): Promise<Record<string, unknown>> {
  if (token.length > 1500) throw new Error("context");
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("context");
  const data = decodeBase64UrlStrict(parts[0]!, 1024);
  if (!constantTimeEqual(decodeBase64UrlStrict(parts[1]!, 64), await hmacSha256(data, env.FORM_SIGNING_KEY))) throw new Error("context");
  const result: unknown = JSON.parse(new TextDecoder().decode(data));
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("context");
  const value = result as Record<string, unknown>;
  if (typeof value.expires !== "number" || !Number.isSafeInteger(value.expires) || value.expires <= Date.now() || value.expires > Date.now() + TTL) throw new Error("expired");
  return value;
}

export async function createVisit(request: Request, env: Env, source: SubmissionSource): Promise<Visit | null> {
  if (!analyticsEnabled(env) || source === "team_test" || new URL(request.url).pathname.startsWith("/preview")) return null;
  if (!await analyticsRateAllowed(request, env)) return null;
  const visit: Visit = { id: crypto.randomUUID(), attribution_id: crypto.randomUUID(), source,
    created_at: new Date().toISOString(), suppressed: trackingAllowed(request, env) ? 0 : 1, expires_at: Date.now() + TTL };
  await env.DB.prepare("INSERT INTO analytics_visits (id,attribution_id,source,created_at,suppressed,expires_at) VALUES (?,?,?,?,?,?)")
    .bind(visit.id, visit.attribution_id, visit.source, visit.created_at, visit.suppressed, visit.expires_at).run();
  return visit;
}

export async function pageToken(visit: Visit, kind: PageContext["kind"], env: Env): Promise<string> {
  return signContext({ kind, visit: visit.id, source: visit.source, expires: Math.min(visit.expires_at, Date.now() + TTL) }, env);
}

export async function readPage(token: unknown, env: Env, kind: PageContext["kind"]): Promise<Visit | null> {
  if (typeof token !== "string") return null;
  try {
    const context = await readContext(token, env);
    if (context.kind !== kind || typeof context.visit !== "string" || !UUID.test(context.visit)) return null;
    return await env.DB.prepare("SELECT * FROM analytics_visits WHERE id = ? AND source = ? AND expires_at > ?")
      .bind(context.visit, context.source, Date.now()).first<Visit>();
  } catch { return null; }
}

export async function suppressVisit(env: Env, id: string): Promise<void> {
  await env.DB.prepare("UPDATE analytics_visits SET suppressed = 1 WHERE id = ?").bind(id).run();
}

export async function enqueueEvent(env: Env, visitId: string, event: WifiEvent, occurredAt: string, key = event + ":" + visitId, detail: "click" | "automatic" | null = null): Promise<void> {
  if (!analyticsEnabled(env)) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO analytics_outbox (id,event_key,visit_id,event,occurred_at,detail)
    SELECT ?,?,id,?,?,? FROM analytics_visits WHERE id = ? AND suppressed = 0 AND created_at >= ?`)
    .bind(crypto.randomUUID(), key, event, occurredAt, detail, visitId, env.ANALYTICS_ROLLOUT_AT!).run();
}

export async function reconcileAnalytics(env: Env): Promise<void> {
  if (!analyticsEnabled(env)) return;
  // Recover only enrolled, post-rollout facts; never inspect/export contact fields.
  const rows = await env.DB.prepare(`SELECT r.id,r.analytics_visit_id AS visit,r.created_at,
    CASE WHEN q.state='acknowledged' AND r.authorization_status='acknowledged' AND (r.ad_gate_required=0 OR r.ad_completed_at IS NOT NULL) THEN q.analytics_ack_at ELSE NULL END AS ack,r.submission_source AS source
    FROM registrations r JOIN analytics_visits v ON v.id = r.analytics_visit_id
    LEFT JOIN auth_queue q ON q.registration_id = r.id
    WHERE r.created_at >= ? AND v.suppressed = 0 AND r.submission_source IN ('wifi','public_web')
      AND (NOT EXISTS (SELECT 1 FROM analytics_outbox o WHERE o.event_key = 'signup:' || r.id)
        OR (r.submission_source = 'wifi' AND q.analytics_ack_at IS NOT NULL AND q.state = 'acknowledged'
          AND r.authorization_status = 'acknowledged' AND (r.ad_gate_required = 0 OR r.ad_completed_at IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM analytics_outbox o WHERE o.event_key = 'connected:' || r.id)))
    ORDER BY r.created_at LIMIT 100`).bind(env.ANALYTICS_ROLLOUT_AT!).all<{ id: string; visit: string; created_at: string; ack: string | null; source: string }>();
  for (const row of rows.results) {
    await enqueueEvent(env, row.visit, "wifi_signup_completed", row.created_at, "signup:" + row.id);
    if (row.source === "wifi" && row.ack) await enqueueEvent(env, row.visit, "wifi_connected", row.ack, "connected:" + row.id);
  }
}

type Sender = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export async function flushOutbox(env: Env, send: Sender = fetch): Promise<void> {
  if (!analyticsEnabled(env) || !env.POSTHOG_PROJECT_TOKEN) return;
  const rows = await env.DB.prepare(`SELECT o.*,v.attribution_id,v.source FROM analytics_outbox o
    JOIN analytics_visits v ON v.id=o.visit_id WHERE o.delivered_at IS NULL AND o.next_attempt_at <= ? AND v.suppressed=0
    ORDER BY o.occurred_at LIMIT 50`).bind(Date.now()).all<{
      id: string; visit_id: string; attribution_id: string; source: string; event: WifiEvent; occurred_at: string; attempts: number; detail: string | null;
    }>();
  if (!rows.results.length) return;
  const ids = rows.results.map(r => r.id);
  const batch = rows.results.map(row => ({ uuid: row.id, event: row.event, distinct_id: "wifi:" + row.visit_id, timestamp: row.occurred_at,
    properties: { wifi_event_id: row.id, wifi_attribution_id: row.attribution_id, wifi_source: row.source,
      wifi_schema: 1, utm_source: "event_wifi", utm_medium: "captive_portal", utm_campaign: "amazon_unboxed_sf_2026",
      ...(row.detail ? { open_method: row.detail } : {}), $process_person_profile: false, $geoip_disable: true } }));
  let ok = false;
  try {
    const response = await send("https://us.i.posthog.com/batch/", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: env.POSTHOG_PROJECT_TOKEN, batch }), signal: AbortSignal.timeout(3000) });
    ok = response.ok;
    await response.body?.cancel();
  } catch { /* Retry with the SAME UUID and occurrence time, not request time. */ }
  await env.DB.batch(ids.map(id => env.DB.prepare(`UPDATE analytics_outbox SET attempts=attempts+1,next_attempt_at=?,delivered_at=?,last_error=? WHERE id=? AND delivered_at IS NULL`)
    .bind(Date.now() + 5 * 60_000, ok ? new Date().toISOString() : null, ok ? null : "delivery_failed", id)));
}

export function backgroundAnalytics(env: Env, ctx: HandlerContext): void {
  if (!analyticsEnabled(env)) return;
  ctx.waitUntil((async () => { try { await reconcileAnalytics(env); await flushOutbox(env); } catch { console.warn(JSON.stringify({ event: "wifi_analytics_deferred" })); } })());
}

export async function enrollment(request: Request, env: Env, token: unknown, source: SubmissionSource): Promise<string | null> {
  if (!analyticsEnabled(env) || source === "team_test") return null;
  try {
    const visit = await optionalAnalytics(readPage(token, env, "form"), null);
    if (!visit || visit.source !== source) return null;
    if (!trackingAllowed(request, env)) {
      await optionalAnalytics(suppressVisit(env, visit.id), undefined);
      return null;
    }
    return visit.id;
  } catch { return null; }
}

export async function formTracking(request: Request, env: Env, source: SubmissionSource): Promise<string> {
  try {
    const visit = await optionalAnalytics(createVisit(request, env, source), null);
    return visit ? await pageToken(visit, "form", env) : "";
  } catch { return ""; }
}
