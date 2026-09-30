import { CONNECTING_MINIMUM_MS } from "./config";
import { verifyStatusState } from "./fas";
import { jsonResponse, secureHtml } from "./http";
import { renderDeniedPage, renderWaitingPage } from "./portal";
import { D1Repository } from "./repository";
import type { Env } from "./types";
import { parseBody, RequestParseError } from "./validation";

export async function handleAdGate(request: Request, env: Env, complete: boolean): Promise<Response> {
  const origin = new URL(request.url).origin;
  if (request.headers.get("Origin") !== origin) return jsonResponse({ error: "forbidden" }, 403);
  let body: Record<string, unknown>;
  try {
    body = await parseBody(request, 4096);
  } catch (error) {
    return jsonResponse({ error: "invalid_request" }, error instanceof RequestParseError ? error.status : 400);
  }
  const { registrationId, token, visibleMs } = body;
  if (typeof registrationId !== "string" || registrationId.length > 100 || typeof token !== "string" ||
    typeof visibleMs !== "number" || !Number.isSafeInteger(visibleMs) || visibleMs < 0 || visibleMs > CONNECTING_MINIMUM_MS) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  const now = Date.now();
  try {
    await verifyStatusState(token, registrationId, now, env.FORM_SIGNING_KEY);
  } catch {
    return jsonResponse({ error: "forbidden" }, 403);
  }
  try {
    const repository = new D1Repository(env.DB);
    const status = await repository.readAuthorizationStatus(registrationId, new Date(now).toISOString());
    if (!status) return jsonResponse({ error: "not_found" }, 404);
    if (status === "expired" || status === "failed") return jsonResponse({ error: "expired" }, 410);
    const gate = complete
      ? await repository.completeAd(registrationId, now, visibleMs)
      : await repository.startAd(registrationId, now, visibleMs);
    if (!gate) return jsonResponse({ error: "not_found" }, 404);
    const requiresGate = gate.ad_gate_required === 1;
    const completed = gate.ad_completed_at !== null;
    const remainingMs = gate.ad_started_at === null ? CONNECTING_MINIMUM_MS : Math.max(0, CONNECTING_MINIMUM_MS - (now - gate.ad_started_at));
    if (complete && requiresGate && !completed) return jsonResponse({ error: "too_early", remainingMs }, 425);
    return jsonResponse({ requiresGate, completed, visibleMs: gate.ad_visible_ms, remainingMs });
  } catch {
    return jsonResponse({ error: "temporarily_unavailable" }, 503);
  }
}

// A GET address makes refresh resume the session instead of resubmitting the form.
export async function handleWaitingPage(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const registrationId = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1) throw new Error("invalid token");
    await verifyStatusState(tokens[0] ?? "", registrationId, Date.now(), env.FORM_SIGNING_KEY);
    try {
      const repository = new D1Repository(env.DB);
      const status = await repository.readAuthorizationStatus(registrationId, new Date(Date.now()).toISOString());
      if (!status || status === "expired" || status === "failed") return secureHtml(renderDeniedPage(), 410);
      const gate = await repository.readAdGate(registrationId);
      return secureHtml(renderWaitingPage(registrationId, tokens[0]!, gate?.ad_gate_required === 1), 200, { "Referrer-Policy": "origin" });
    } catch {
      return secureHtml(renderDeniedPage(), 503);
    }
  } catch {
    return secureHtml(renderDeniedPage(), 410);
  }
}
