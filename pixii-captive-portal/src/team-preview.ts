import { CONSENT_TEXT, CONSENT_VERSION, FORM_BODY_LIMIT } from "./config";
import {
  constantTimeEqual,
  hmacSha256,
  utf8Bytes
} from "./crypto";
import { secureHtml } from "./http";
import { signStatusState } from "./fas";
import {
  renderTeamTestDataPage,
  renderTeamTestPage,
  renderPublicSignupPage,
  renderWaitingPage,
  type SignupValues
} from "./portal";
import { D1Repository } from "./repository";
import type { Env } from "./types";
import { parseBody, RequestParseError, validateSignup } from "./validation";

const TEAM_USERNAME = "pixii";
const ROUTER_ID = "rtr_puli";
const AUTH_COMPARISON_KEY = "pixii-team-preview-basic-auth-v1";
// Preserve Origin on browser form POSTs without sending referrers to other sites.
const FORM_HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "same-origin" };

function unauthorized(): Response {
  return secureHtml(
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Sign in required</title><p>Team sign-in required.</p></html>",
    401,
    { "WWW-Authenticate": 'Basic realm="Pixii team test", charset="UTF-8"' }
  );
}

async function authorized(request: Request, env: Env): Promise<boolean> {
  if (!env.PREVIEW_TEST_PASSWORD) return false;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) return false;

  let supplied: string;
  try {
    supplied = atob(header.slice(6));
  } catch {
    return false;
  }
  const colon = supplied.indexOf(":");
  if (colon < 0) return false;
  const username = supplied.slice(0, colon);
  const password = supplied.slice(colon + 1);
  const [actual, expected] = await Promise.all([
    hmacSha256(utf8Bytes(`${username}\0${password}`), AUTH_COMPARISON_KEY),
    hmacSha256(utf8Bytes(`${TEAM_USERNAME}\0${env.PREVIEW_TEST_PASSWORD}`), AUTH_COMPARISON_KEY)
  ]);
  return constantTimeEqual(actual, expected);
}

function blocked(): Response {
  return secureHtml(
    "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Request blocked</title><p>Please reopen the signup page and try again.</p></html>",
    403,
    { "X-Robots-Tag": "noindex, nofollow" }
  );
}

function signupValues(body: Record<string, unknown>): Partial<SignupValues> {
  return {
    fullName: typeof body.fullName === "string" ? body.fullName : "",
    email: typeof body.email === "string" ? body.email : "",
    phoneCountry: typeof body.phoneCountry === "string" ? body.phoneCountry : "US",
    phone: typeof body.phone === "string" ? body.phone : ""
  };
}

export function handleTeamTest(request: Request, env: Env): Promise<Response> {
  return handleStandaloneSignup(request, env, "team-test");
}

export function handlePublicSignup(request: Request, env: Env): Promise<Response> {
  return handleStandaloneSignup(request, env, "public");
}

async function handleStandaloneSignup(request: Request, env: Env, mode: "public" | "team-test"): Promise<Response> {
  const renderPage = mode === "public" ? renderPublicSignupPage : renderTeamTestPage;
  const submissionSource = mode === "public" ? "public_web" : "team_test";
  if (request.method === "GET") {
    return secureHtml(renderPage({
      formState: ""
    }), 200, FORM_HEADERS);
  }
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin) return blocked();

  let body: Record<string, unknown>;
  try {
    body = await parseBody(request, FORM_BODY_LIMIT);
  } catch (error) {
    const status = error instanceof RequestParseError ? error.status : 400;
    return secureHtml(renderPage({
      formState: "",
      errors: { form: "Check the form and try again." }
    }), status, FORM_HEADERS);
  }

  const validation = validateSignup(body);
  if (!validation.ok) {
    return secureHtml(renderPage({
      formState: "",
      values: signupValues(body),
      errors: validation.errors
    }), 400, FORM_HEADERS);
  }

  try {
    const repository = new D1Repository(env.DB);
    const router = await repository.findRouterById(ROUTER_ID);
    if (!router?.enabled) throw new Error("event signup unavailable");
    const now = new Date().toISOString();
    const registrationId = crypto.randomUUID();
    await repository.createStandaloneRegistration({
      id: registrationId,
      eventId: router.eventId,
      routerId: router.id,
      fullName: validation.value.fullName,
      email: validation.value.email,
      emailNormalized: validation.value.emailNormalized,
      phoneCountry: validation.value.phoneCountry,
      phoneE164: validation.value.phoneE164,
      consentEmailMarketing: true,
      consentVersion: CONSENT_VERSION,
      consentText: CONSENT_TEXT,
      consentedAt: now,
      createdAt: now,
      authorizationStatus: "acknowledged",
      formIdempotencyKey: `${submissionSource}:${registrationId}`,
      submissionSource,
      requiresAdGate: true
    });
    const token = await signStatusState(registrationId, Date.now() + 10 * 60_000, env.FORM_SIGNING_KEY);
    return secureHtml(renderWaitingPage(registrationId, token), 201, FORM_HEADERS);
  } catch {
    return secureHtml(renderPage({
      formState: "",
      values: signupValues(body),
      errors: { form: "Your details could not be saved. Try again in a moment." }
    }), 503, FORM_HEADERS);
  }
}

export async function handleTeamTestData(request: Request, env: Env): Promise<Response> {
  if (!await authorized(request, env)) return unauthorized();
  const rows = await new D1Repository(env.DB).listRegistrationsForAdmin();
  return secureHtml(renderTeamTestDataPage(rows), 200, {
    "X-Robots-Tag": "noindex, nofollow"
  });
}
