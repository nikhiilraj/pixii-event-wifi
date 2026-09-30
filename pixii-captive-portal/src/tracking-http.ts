import type { Env, HandlerContext } from "./types";
import { analyticsEnabled, analyticsRateAllowed, backgroundAnalytics, enqueueEvent, optionalAnalytics, optedOut, pageToken, readContext, readPage, signContext, suppressVisit, trackingAllowed, type Visit } from "./analytics";
import { sha256Hex, encodeBase64Url } from "./crypto";
import { jsonResponse, secureHtml } from "./http";
import { connectedContent, documentShell, renderDeniedPage, PIXII_CTA_URL } from "./portal";
import { parseBody, RequestParseError } from "./validation";

const WEBSITE = "https://www.pixii.ai";
const COOKIE = "__Host-pixii_connected";
interface FinalSession { id: string; submission_source: string; analytics_visit_id: string | null }

async function finalSession(env: Env, id: string): Promise<FinalSession | null> {
  return env.DB.prepare(`SELECT r.id,r.submission_source,r.analytics_visit_id FROM registrations r
    LEFT JOIN auth_queue q ON q.registration_id=r.id WHERE r.id=? AND r.authorization_status='acknowledged'
    AND r.ad_gate_required=1 AND r.ad_completed_at IS NOT NULL AND r.ad_visible_ms >= 7000
    AND (r.submission_source='public_web' OR (r.submission_source='wifi' AND q.state='acknowledged' AND q.analytics_ack_at IS NOT NULL))`)
    .bind(id).first<FinalSession>();
}

// Called only after the existing signed status endpoint returns connected.
export async function cleanFinalResponse(response: Response, env: Env, id: string): Promise<Response> {
  if (!analyticsEnabled(env)) return response;
  try {
    if (!await optionalAnalytics(finalSession(env, id), null)) return response;
    const token = await signContext({ kind: "connected_session", id, expires: Date.now() + 180_000 }, env);
    const headers = new Headers(response.headers);
    headers.append("Set-Cookie", `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=180`);
    return new Response(JSON.stringify({ status: "connected", connectedUrl: "/connected" }), { status: response.status, headers });
  } catch { return response; }
}

export async function handleAnalyticsEvent(request: Request, env: Env, ctx: HandlerContext): Promise<Response> {
  if (!analyticsEnabled(env) || request.headers.get("Origin") !== new URL(request.url).origin) return jsonResponse({ error: "forbidden" }, 403);
  try {
    const body = await parseBody(request, 2048);
    if (!await analyticsRateAllowed(request, env)) return jsonResponse({ error: "rate_limited" }, 429);
    if (Object.keys(body).some(k => !["event", "context", "method", "optOut"].includes(k))) return jsonResponse({ error: "invalid" }, 400);
    const kind = body.event === "wifi_form_viewed" ? "form" : body.event === "wifi_pixii_open_requested" ? "connected" : null;
    if (!kind) return jsonResponse({ error: "forbidden" }, 403);
    const visit = await readPage(body.context, env, kind);
    if (!visit) return jsonResponse({ error: "forbidden" }, 403);
    if (body.optOut === true || !trackingAllowed(request, env)) await suppressVisit(env, visit.id);
    if (body.optOut === true || visit.suppressed || !trackingAllowed(request, env)) return jsonResponse({ accepted: false }, 202);
    if (kind === "connected" && body.method !== "click" && body.method !== "automatic") return jsonResponse({ error: "invalid" }, 400);
    // Only one view and one event per open method per signed, expiring visit.
    // No arbitrary event properties, IDs, counters or timestamps accepted.
    const detail = kind === "connected" ? body.method as "click" | "automatic" : null;
    await enqueueEvent(env, visit.id, kind === "form" ? "wifi_form_viewed" : "wifi_pixii_open_requested", new Date().toISOString(), `${kind}:${visit.id}:${detail ?? "view"}`, detail);
    backgroundAnalytics(env, ctx);
    return jsonResponse({ accepted: true }, 202);
  } catch (error) { return jsonResponse({ error: error instanceof RequestParseError ? "invalid" : "unavailable" }, error instanceof RequestParseError ? error.status : 503); }
}

export async function issueHandoff(env: Env, visit: Visit): Promise<string> {
  const token = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO attribution_handoffs(token_hash,visit_id,created_at,expires_at) VALUES(?,?,?,?)")
    .bind(await sha256Hex(token), visit.id, Date.now(), Date.now() + 10 * 60_000).run();
  return token;
}

export async function handleRedeem(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Origin") !== WEBSITE) return jsonResponse({ error: "forbidden" }, 403);
  const cors = (response: Response) => {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", WEBSITE); headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Methods", "POST"); headers.set("Access-Control-Allow-Headers", "Content-Type");
    return new Response(response.body, { status: response.status, headers });
  };
  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
  if (!analyticsEnabled(env)) return cors(jsonResponse({ error: "unavailable", suppressed: true }, 503));
  try {
    const body = await parseBody(request, 1024);
    if (!await analyticsRateAllowed(request, env)) return cors(jsonResponse({ error: "rate_limited", suppressed: true }, 429));
    if (Object.keys(body).some(k => !["token", "optOut"].includes(k)) || typeof body.token !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(body.token)) return cors(jsonResponse({ error: "invalid", suppressed: true }, 400));
    const claimed = await env.DB.prepare(`UPDATE attribution_handoffs SET redeemed_at=?
      WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>? RETURNING visit_id`)
      .bind(Date.now(), await sha256Hex(body.token), Date.now()).first<{ visit_id: string }>();
    if (!claimed) return cors(jsonResponse({ error: "expired_or_used", suppressed: true }, 410));
    if (body.optOut === true || !trackingAllowed(request, env)) await suppressVisit(env, claimed.visit_id);
    const visit = await env.DB.prepare("SELECT * FROM analytics_visits WHERE id=?").bind(claimed.visit_id).first<Visit>();
    if (!visit || visit.suppressed) return cors(jsonResponse({ suppressed: true }));
    return cors(jsonResponse({ suppressed: false, attributionId: visit.attribution_id, source: visit.source, occurredAt: new Date().toISOString(), eventId: crypto.randomUUID() }));
  } catch (error) { return cors(jsonResponse({ error: error instanceof RequestParseError ? "invalid" : "unavailable", suppressed: true }, error instanceof RequestParseError ? error.status : 503)); }
}

function scriptJson(value: unknown): string { return JSON.stringify(value).replaceAll("<", "\\u003c"); }

// Old connecting documents may still carry a full signed session URL as their
// referrer. Keep their final screen working, but do not expose it to vendors.
export function hasSafePixelReferrer(request: Request): boolean {
  const value = request.headers.get("Referer");
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.origin === new URL(request.url).origin && !url.search && !url.hash
      && (url.pathname === "/" || url.pathname === "/connected");
  } catch { return false; }
}

export async function handleConnected(request: Request, env: Env): Promise<Response> {
  try {
    if (!analyticsEnabled(env)) throw new Error("disabled");
    const token = request.headers.get("Cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
    const context = await readContext(token ?? "", env);
    if (context.kind !== "connected_session" || typeof context.id !== "string") throw new Error("session");
    const session = await finalSession(env, context.id);
    if (!session) throw new Error("state");
    let visit = session.analytics_visit_id ? await env.DB.prepare("SELECT * FROM analytics_visits WHERE id=?").bind(session.analytics_visit_id).first<Visit>() : null;
    const allowed = trackingAllowed(request, env);
    if (visit && !allowed) { await suppressVisit(env, visit.id); visit = { ...visit, suppressed: 1 }; }
    const suppressed = !visit || visit.suppressed === 1 || !allowed;
    const preference = optedOut(request) ? "&pixii_optout=1" : "";
    let destination = PIXII_CTA_URL + "#pixii_privacy=off" + preference;
    let telemetry = "";
    try {
      if (visit) {
        destination = PIXII_CTA_URL + "#pixii_wifi=" + await issueHandoff(env, visit) + (suppressed ? "&pixii_privacy=off" : "") + preference;
        telemetry = await pageToken(visit, "connected", env);
      }
    } catch { /* Keep the ordinary website link even if analytics storage fails. */ }
    const ads = !suppressed && session.submission_source === "wifi" && env.PIXELS_ENABLED === "true" && hasSafePixelReferrer(request);
    const pixels = {
      meta: ads && env.META_ENABLED === "true" ? "571544668799364" : "",
      google: ads && env.GOOGLE_ENABLED === "true" ? ["G-FRVEG530RV", "G-E1JECZVBRZ", "AW-18294844879"] : [],
      linkedin: ads && env.LINKEDIN_ENABLED === "true" && /^\d+$/u.test(env.LINKEDIN_PARTNER_ID ?? "") ? env.LINKEDIN_PARTNER_ID : "",
      rb2b: ads && env.RB2B_ENABLED === "true" && env.RB2B_DOMAIN_VERIFIED === "true" ? "GOYPYH4421OX" : ""
    };
    const body = documentShell("You're online | Pixii", connectedContent(destination) +
      `<script>window.pixiiTracking=${scriptJson({ context: telemetry, page: "connected", pixels, suppressed, optOut: optedOut(request) })};</script><script src="/assets/analytics-v1.js" defer></script><script src="/assets/connected-v4.js" defer></script>`, "app-theme");
    const response = secureHtml(body, 200, { "X-Pixii-Clean-Final": "1", "X-Robots-Tag": "noindex, nofollow" });
    const hosts = new Set<string>();
    if (pixels.meta) { hosts.add("https://connect.facebook.net"); hosts.add("https://www.facebook.com"); }
    if (pixels.google.length) ["https://www.googletagmanager.com", "https://www.google-analytics.com", "https://region1.google-analytics.com", "https://analytics.google.com", "https://www.google.com", "https://www.googleadservices.com", "https://googleads.g.doubleclick.net", "https://stats.g.doubleclick.net", "https://ad.doubleclick.net"].forEach(h => hosts.add(h));
    if (pixels.linkedin) ["https://snap.licdn.com", "https://px.ads.linkedin.com", "https://px4.ads.linkedin.com"].forEach(h => hosts.add(h));
    // RB2B remains gated until this exact dependency set is verified in its dashboard.
    if (pixels.rb2b) hosts.add("https://ddwl4m2hdecbv.cloudfront.net");
    if (hosts.size) {
      const allow = [...hosts].join(" ");
      // Verified regional image redirect during the India-based browser check.
      // Do not grant the regional host script or connection permissions.
      const imageAllow = pixels.google.length ? `${allow} https://www.google.co.in` : allow;
      response.headers.set("Content-Security-Policy", `default-src 'none'; img-src 'self' ${imageAllow}; media-src 'self'; font-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline' ${allow}; connect-src 'self' ${allow}; frame-src ${allow}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
    }
    return response;
  } catch { return secureHtml(renderDeniedPage(), 403); }
}
