import { AUTHMON_BODY_LIMIT, CONNECTING_MINIMUM_MS, CONSENT_TEXT, CONSENT_VERSION, FORM_BODY_LIMIT } from "./config";
import {
  constantTimeEqual,
  decodeBase64Strict,
  decodeBase64UrlStrict,
  encodeBase64Url,
  hmacSha256,
  sha256Hex,
  utf8Bytes
} from "./crypto";
import { jsonResponse, plainResponse, secureHtml } from "./http";
import {
  buildAuthRecord,
  decryptFasPayload,
  encodeAuthList,
  gatewayHash,
  parseFasFields,
  parseAckPayload,
  returnHash,
  signFormState,
  verifyFormState
} from "./opennds";
import {
  renderDeniedPage,
  renderSignupPage,
  renderWaitingPage,
  type SignupValues
} from "./portal";
import { D1Repository, type AuthorizationStatus } from "./repository";
import type { Env, HandlerContext } from "./types";
import { backgroundAnalytics, enrollment, formTracking } from "./analytics";
import { cleanFinalResponse } from "./tracking-http";
import { parseBody, RequestParseError, validateSignup } from "./validation";
import { FasDiagnosticError, logFasRejection, type FasDiagnosticContext } from "./fas-diagnostics";

const FORM_LIFETIME_MS = 10 * 60_000;
const QUEUE_LIFETIME_MS = 90_000;

interface StatusState {
  registrationId: string;
  expiresAt: number;
  readyAt: number;
}

function singleQueryValue(url: URL, name: string): string {
  const values = url.searchParams.getAll(name);
  if (values.length !== 1 || !values[0]) throw new Error("invalid query");
  return values[0];
}

function stringField(input: Record<string, unknown>, name: string): string {
  const value = input[name];
  if (typeof value !== "string" || value.length === 0) throw new Error("invalid field");
  return value;
}

async function resolveGateway(fas: string, iv: string, env: Env, diagnostic: FasDiagnosticContext): Promise<{
  fields: ReturnType<typeof parseFasFields>;
  router: NonNullable<Awaited<ReturnType<D1Repository["findRouterByGatewayName"]>>>;
}> {
  diagnostic.stage = "decrypt";
  const plaintext = await decryptFasPayload(fas, iv, env.FAS_KEY);
  diagnostic.stage = "fields";
  const fields = parseFasFields(plaintext);
  diagnostic.stage = "router_lookup";
  const repository = new D1Repository(env.DB);
  const router = await repository.findRouterByGatewayName(fields.gatewayname);
  if (!router) throw new FasDiagnosticError("router_unknown");
  if (!router.enabled) throw new FasDiagnosticError("router_disabled");
  diagnostic.stage = "router_identity";
  parseFasFields(plaintext, router.gatewayName);
  if (router.gatewayHash !== await gatewayHash(router.gatewayName)) {
    throw new FasDiagnosticError("router_identity_mismatch");
  }
  return { fields, router };
}

export async function handleFasPage(request: Request, env: Env): Promise<Response> {
  const diagnostic: FasDiagnosticContext = { stage: "query_fas" };
  try {
    const url = new URL(request.url);
    const fas = singleQueryValue(url, "fas");
    diagnostic.stage = "query_iv";
    const iv = singleQueryValue(url, "iv");
    const { router } = await resolveGateway(fas, iv, env, diagnostic);
    diagnostic.stage = "form_signing";
    const state = await signFormState(
      fas,
      iv,
      router.gatewayName,
      Date.now() + FORM_LIFETIME_MS,
      env.FORM_SIGNING_KEY
    );
    diagnostic.stage = "render";
    return secureHtml(renderSignupPage({ formState: state, fas, iv, analyticsContext: await formTracking(request, env, "wifi") }));
  } catch (error) {
    const reference = logFasRejection("/router/fas", diagnostic, error);
    return secureHtml(renderDeniedPage(reference), 403, { "X-Pixii-Request-ID": reference });
  }
}

export async function signStatusState(
  registrationId: string,
  expiresAt: number,
  signingKey: string,
  readyAt = Date.now() + CONNECTING_MINIMUM_MS
): Promise<string> {
  const payload = utf8Bytes(JSON.stringify({ registrationId, expiresAt, readyAt } satisfies StatusState));
  const signature = await hmacSha256(payload, signingKey);
  return `${encodeBase64Url(payload)}.${encodeBase64Url(signature)}`;
}

export async function verifyStatusState(
  token: string,
  registrationId: string,
  nowMs: number,
  signingKey: string
): Promise<StatusState> {
  if (token.length > 1_024) throw new Error("invalid status state");
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("invalid status state");
  const payload = decodeBase64UrlStrict(parts[0] ?? "", 512);
  const supplied = decodeBase64UrlStrict(parts[1] ?? "", 64);
  const expected = await hmacSha256(payload, signingKey);
  if (!constantTimeEqual(supplied, expected)) throw new Error("invalid status state");
  const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    throw new Error("invalid status state");
  }
  const state = decoded as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(state).sort()) !== JSON.stringify(["expiresAt", "readyAt", "registrationId"]) ||
    state.registrationId !== registrationId ||
    !Number.isSafeInteger(state.expiresAt) ||
    (state.expiresAt as number) <= nowMs ||
    (state.expiresAt as number) > nowMs + FORM_LIFETIME_MS ||
    !Number.isSafeInteger(state.readyAt) || (state.readyAt as number) > (state.expiresAt as number)
  ) {
    throw new Error("invalid status state");
  }
  return state as unknown as StatusState;
}

function signupValues(body: Record<string, unknown>): Partial<SignupValues> {
  return {
    fullName: typeof body.fullName === "string" ? body.fullName : "",
    email: typeof body.email === "string" ? body.email : "",
    phoneCountry: typeof body.phoneCountry === "string" ? body.phoneCountry : "US",
    phone: typeof body.phone === "string" ? body.phone : ""
  };
}

export async function handleFasSubmit(request: Request, env: Env, ctx?: HandlerContext): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await parseBody(request, FORM_BODY_LIMIT);
  } catch (error) {
    if (error instanceof RequestParseError) {
      return secureHtml(renderDeniedPage(), error.status);
    }
    return secureHtml(renderDeniedPage(), 400);
  }

  let fas: string;
  let iv: string;
  let state: string;
  let gateway: Awaited<ReturnType<typeof resolveGateway>>;
  const diagnostic: FasDiagnosticContext = { stage: "submit_fields" };
  try {
    fas = stringField(body, "fas");
    iv = stringField(body, "iv");
    state = stringField(body, "state");
    gateway = await resolveGateway(fas, iv, env, diagnostic);
    diagnostic.stage = "form_state";
    await verifyFormState(
      state,
      fas,
      iv,
      gateway.router.gatewayName,
      Date.now(),
      env.FORM_SIGNING_KEY
    );
  } catch (error) {
    const reference = logFasRejection("/router/fas/submit", diagnostic, error);
    return secureHtml(renderDeniedPage(reference), 403, { "X-Pixii-Request-ID": reference });
  }

  const validation = validateSignup(body);
  if (!validation.ok) {
    return secureHtml(renderSignupPage({
      formState: state,
      fas,
      iv,
      values: signupValues(body),
      errors: validation.errors,
      analyticsContext: typeof body.analyticsContext === "string" ? body.analyticsContext : ""
    }), 400);
  }

  try {
    const repository = new D1Repository(env.DB);
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + QUEUE_LIFETIME_MS).toISOString();
    const registrationId = crypto.randomUUID();
    const rhid = await returnHash(gateway.fields.hid, env.FAS_KEY);
    const formIdempotencyKey = await sha256Hex(
      `${gateway.router.eventId}\0${gateway.router.id}\0${gateway.fields.hid}`
    );
    const result = await repository.createRegistrationAndAuthorization({
      id: registrationId,
      eventId: gateway.router.eventId,
      routerId: gateway.router.id,
      fullName: validation.value.fullName,
      email: validation.value.email,
      emailNormalized: validation.value.emailNormalized,
      phoneCountry: validation.value.phoneCountry,
      phoneE164: validation.value.phoneE164,
      consentEmailMarketing: true,
      consentVersion: CONSENT_VERSION,
      consentText: CONSENT_TEXT,
      consentedAt: createdAt,
      createdAt,
      authorizationStatus: "pending",
      formIdempotencyKey,
      submissionSource: "wifi",
      analyticsVisitId: body.analyticsOptOut === "1" ? null : await enrollment(request, env, body.analyticsContext, "wifi"),
      requiresAdGate: true
    }, {
      rhid,
      registrationId,
      gatewayHash: gateway.router.gatewayHash,
      authRecord: await buildAuthRecord(gateway.fields.hid, env.FAS_KEY, registrationId),
      state: "pending",
      createdAt,
      expiresAt,
      availableAt: new Date(now.getTime() + CONNECTING_MINIMUM_MS).toISOString()
    });
    const gate = await repository.readAdGate(result.id);
    if (ctx) backgroundAnalytics(env, ctx);
    const statusToken = await signStatusState(
      result.id,
      Date.now() + FORM_LIFETIME_MS,
      env.FORM_SIGNING_KEY,
      Date.now() + (gate?.ad_gate_required === 1 ? CONNECTING_MINIMUM_MS : 6000)
    );
    return secureHtml(renderWaitingPage(result.id, statusToken, gate?.ad_gate_required === 1), 202, { "Referrer-Policy": "same-origin" });
  } catch {
    return secureHtml(renderDeniedPage(), 503);
  }
}

function browserStatus(status: AuthorizationStatus): "pending" | "connected" | "expired" {
  if (status === "acknowledged") return "connected";
  if (status === "pending") return "pending";
  return "expired";
}

export async function handleFasStatus(request: Request, env: Env): Promise<Response> {
  const notFound = (): Response => jsonResponse({ error: "not_found" }, 404);
  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/router\/fas\/status\/([^/]+)$/u);
    if (!match?.[1]) return notFound();
    const registrationId = decodeURIComponent(match[1]);
    const token = singleQueryValue(url, "token");
    const state = await verifyStatusState(token, registrationId, Date.now(), env.FORM_SIGNING_KEY);
    try {
      const repository = new D1Repository(env.DB);
      const status = await repository.readAuthorizationStatus(registrationId, new Date(Date.now()).toISOString());
      if (!status) return notFound();
      const gate = await repository.readAdGate(registrationId);
      const shownStatus = status === "acknowledged" && gate?.ad_gate_required !== 1 && Date.now() < state.readyAt ? "pending" : browserStatus(status);
      const response = jsonResponse({ status: shownStatus });
      return shownStatus === "connected" ? cleanFinalResponse(response, env, registrationId) : response;
    } catch {
      return jsonResponse({ error: "temporarily_unavailable" }, 503);
    }
  } catch {
    return notFound();
  }
}

const AUTHMON_METHODS = new Set(["clear", "list", "view", "deauthed", "custom"]);

function decodeAuthmonText(payload: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Strict(payload, 2_048));
}

function decodeHex(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("invalid signature");
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function handleAuthmon(request: Request, env: Env, ctx?: HandlerContext): Promise<Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") return plainResponse("", 415);

  let body: Record<string, unknown>;
  try {
    body = await parseBody(request, AUTHMON_BODY_LIMIT);
  } catch (error) {
    return plainResponse("", error instanceof RequestParseError ? error.status : 400);
  }

  try {
    const keys = Object.keys(body).sort();
    const legacyShape = JSON.stringify(["auth_get", "gatewayhash", "payload"]);
    const signedShape = JSON.stringify(["auth_get", "gatewayhash", "payload", "signature"]);
    if (
      ![legacyShape, signedShape].includes(JSON.stringify(keys)) ||
      typeof body.auth_get !== "string" ||
      !AUTHMON_METHODS.has(body.auth_get) ||
      typeof body.gatewayhash !== "string" ||
      !/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/u.test(body.gatewayhash) ||
      typeof body.payload !== "string" ||
      (Object.hasOwn(body, "signature") && typeof body.signature !== "string")
    ) {
      return plainResponse("", 400);
    }

    const method = body.auth_get as "clear" | "list" | "view" | "deauthed" | "custom";
    const gatewayHashValue = body.gatewayhash;
    const payload = body.payload;
    const decodedPayload = decodeAuthmonText(payload);
    if (typeof body.signature !== "string") return plainResponse("");
    const expectedSignature = await hmacSha256(
      utf8Bytes(`${method}\n${gatewayHashValue}\n${payload}`),
      env.FAS_KEY
    );
    if (!constantTimeEqual(decodeHex(body.signature), expectedSignature)) return plainResponse("");
    const repository = new D1Repository(env.DB);
    // Authenticate the exact received ID BEFORE resolving a compatibility alias.
    // All queue operations continue to use the stored, full-length identity.
    const router = await repository.findRouterByGatewayHash(gatewayHashValue);
    if (!router || !router.enabled) return plainResponse("");

    if (method === "deauthed") return plainResponse("ack");
    if (method === "custom") return plainResponse(decodedPayload === "health" ? "ack" : "");

    const acknowledgements = parseAckPayload(payload);
    const now = new Date().toISOString();
    if (method === "clear") {
      await repository.clearGatewayAuthorizations(router.gatewayHash);
      return plainResponse("");
    }

    const result = await repository.authmonPoll({
      gatewayHash: router.gatewayHash,
      mode: method,
      acknowledgedRhids: method === "view" ? acknowledgements : [],
      now,
      limit: 4
    });
    if (ctx) backgroundAnalytics(env, ctx);
    return plainResponse(encodeAuthList(result.records.map(({ authRecord }) => authRecord)));
  } catch {
    return plainResponse("", 400);
  }
}
