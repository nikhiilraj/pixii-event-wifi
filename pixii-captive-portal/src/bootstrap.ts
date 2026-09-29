import {
  BOOTSTRAP_BODY_LIMIT,
  DATA_QUOTA_KB,
  DOWNLOAD_KBPS,
  IDLE_MINUTES,
  SESSION_MINUTES,
  SSID,
  UPLOAD_KBPS
} from "./config";
import { hmacSha256, utf8Bytes } from "./crypto";
import { jsonResponse } from "./http";
import { D1Repository, type BootstrapCandidate } from "./repository";
import type { Env } from "./types";
import { parseBody, RequestParseError, validateBootstrapRequest } from "./validation";

const PORTAL_HOSTNAME = "wifi.pixii.ai";
const FAS_PATH = "/router/fas";
const RETRY_WINDOW_MS = 10 * 60_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tokenHash(rawToken: string, secret: string): Promise<string> {
  return bytesToHex(await hmacSha256(utf8Bytes(rawToken), secret));
}

function errorResponse(status: number): Response {
  return jsonResponse({ error: "bootstrap_rejected" }, status);
}

function bootstrapBody(candidate: BootstrapCandidate, fasKey: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(fasKey)) throw new Error("invalid FAS key");
  if (!/^[a-z0-9](?:[a-z0-9-]{6,62})[a-z0-9]$/u.test(candidate.router.gatewayName)) {
    throw new Error("invalid gateway name");
  }
  if (candidate.router.profileId !== "gl-xe3000-stock-v1") throw new Error("invalid profile");
  const expiryTimestamp = Date.parse(candidate.expiresAt);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(candidate.expiresAt)
    || !Number.isFinite(expiryTimestamp)
    || new Date(expiryTimestamp).toISOString() !== candidate.expiresAt.replace(/Z$/u, ".000Z")
  ) {
    throw new Error("invalid expiry");
  }
  return {
    data_quota_kb: DATA_QUOTA_KB,
    download_kbps: DOWNLOAD_KBPS,
    expires_at: candidate.expiresAt,
    fas_key: fasKey,
    fas_path: FAS_PATH,
    fas_port: 443,
    fas_secure_level: 3,
    fas_url: `https://${PORTAL_HOSTNAME}${FAS_PATH}`,
    gateway_name: candidate.router.gatewayName,
    idle_minutes: IDLE_MINUTES,
    portal_hostname: PORTAL_HOSTNAME,
    profile_version: candidate.router.profileId,
    session_minutes: SESSION_MINUTES,
    ssid: SSID,
    upload_kbps: UPLOAD_KBPS
  };
}

export async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return errorResponse(415);

  let body: Record<string, unknown>;
  try {
    body = await parseBody(request, BOOTSTRAP_BODY_LIMIT);
  } catch (error) {
    return errorResponse(error instanceof RequestParseError ? error.status : 400);
  }

  const validation = validateBootstrapRequest(body);
  if (!validation.ok) return errorResponse(400);

  try {
    const now = new Date();
    let preparedBody: Record<string, unknown> | null = null;
    const result = await new D1Repository(env.DB).exchangeBootstrapToken({
      tokenHash: await tokenHash(validation.value.bootstrapToken, env.BOOTSTRAP_HMAC_KEY),
      profileId: validation.value.profileId,
      now: now.toISOString(),
      retryWindowStart: new Date(now.getTime() - RETRY_WINDOW_MS).toISOString()
    }, (candidate) => {
      try {
        preparedBody = bootstrapBody(candidate, env.FAS_KEY);
        return true;
      } catch {
        return false;
      }
    });
    if (result.status === "not_found") return errorResponse(404);
    if (result.status === "exhausted") return errorResponse(409);
    if (result.status === "invalid_response") return errorResponse(503);
    if (result.status !== "ok") return errorResponse(403);
    if (!preparedBody) return errorResponse(503);
    return jsonResponse(preparedBody);
  } catch {
    return errorResponse(503);
  }
}
