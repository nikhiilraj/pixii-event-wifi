import type { Env, HandlerContext } from "./types";
import poppiOneToSeven from "./assets/poppi-one-to-seven.webp";
import drSquatchCompleteListing from "./assets/dr-squatch-complete-listing.webp";
import { handleAuthmon, handleFasPage, handleFasStatus, handleFasSubmit } from "./fas";
import { handleBootstrap } from "./bootstrap";
import { handleAdGate, handleWaitingPage } from "./ad-gate";
import {
  renderConnectedPage,
  renderConnectingPreviewPage,
  renderNoticePage,
  renderPreviewPage
} from "./portal";
import { handlePublicSignup, handleTeamTest, handleTeamTestData } from "./team-preview";
import { handleAnalyticsEvent, handleConnected, handleRedeem } from "./tracking-http";

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self'",
  "media-src 'self'",
  "font-src 'self'",
  "style-src 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

const DYNAMIC_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

type Route = {
  readonly path: string | RegExp;
  readonly methods: readonly string[];
};

const SHOWCASE_ASSETS: Readonly<Record<string, ArrayBuffer>> = {
  "/assets/poppi-one-to-seven.webp": poppiOneToSeven,
  "/assets/dr-squatch-complete-listing.webp": drSquatchCompleteListing
};

const ROUTES: readonly Route[] = [
  { path: "/analytics/events", methods: ["POST"] },
  { path: "/connected", methods: ["GET"] },
  { path: "/attribution/redeem", methods: ["POST", "OPTIONS"] },
  { path: "/", methods: ["GET", "POST"] },
  { path: "/router/bootstrap", methods: ["POST"] },
  { path: "/router/fas", methods: ["GET", "POST"] },
  { path: "/router/fas/submit", methods: ["POST"] },
  { path: /^\/router\/fas\/status\/[^/]+$/, methods: ["GET"] },
  { path: /^\/router\/fas\/wait\/[^/]+$/, methods: ["GET"] },
  { path: "/router/fas/ad/start", methods: ["POST"] },
  { path: "/router/fas/ad/complete", methods: ["POST"] },
  { path: "/assets/poppi-one-to-seven.webp", methods: ["GET", "HEAD"] },
  { path: "/assets/dr-squatch-complete-listing.webp", methods: ["GET", "HEAD"] },
  { path: "/notice", methods: ["GET"] },
  { path: "/preview", methods: ["GET"] },
  { path: "/preview/test", methods: ["GET", "POST"] },
  { path: "/preview/data", methods: ["GET"] },
  { path: "/preview/connecting", methods: ["GET"] },
  { path: "/preview/connected", methods: ["GET"] },
  { path: "/health", methods: ["GET"] }
];

function matches(route: Route, pathname: string): boolean {
  return typeof route.path === "string" ? route.path === pathname : route.path.test(pathname);
}

export function secureHtml(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...DYNAMIC_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      ...headers
    }
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...DYNAMIC_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export function plainResponse(body: string, status = 200, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...DYNAMIC_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
      ...headers
    }
  });
}

function showcaseImageResponse(method: string, asset: ArrayBuffer): Response {
  return new Response(method === "HEAD" ? null : asset, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Length": String(asset.byteLength),
      "Content-Type": "image/webp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function healthResponse(env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (row?.ok !== 1) throw new Error("health check failed");
    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ ok: false }, 503);
  }
}

export async function routeRequest(
  request: Request,
  _env: Env,
  _ctx: HandlerContext
): Promise<Response> {
  const { pathname } = new URL(request.url);
  // Explicit dispatch also works when wifi.pixii.ai calls this Worker through its Pages service binding.
  if (pathname.startsWith("/assets/flybyjing/v1/") || pathname.startsWith("/assets/bloom/v1/") || pathname.startsWith("/assets/app-theme/v1/") || pathname === "/assets/connected-v1.js" || pathname === "/assets/connected-v2.js" || pathname === "/assets/connected-v3.js" || pathname === "/assets/connected-v4.js" || pathname === "/assets/analytics-v1.js") {
    if (request.method !== "GET" && request.method !== "HEAD") return plainResponse("Method not allowed", 405, { Allow: "GET, HEAD" });
    const asset = await _env.ASSETS.fetch(request);
    const headers = new Headers(asset.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (asset.ok) headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return new Response(asset.body, { status: asset.status, headers });
  }
  const route = ROUTES.find((candidate) => matches(candidate, pathname));

  if (!route) {
    return plainResponse("Not found", 404);
  }

  if (!route.methods.includes(request.method)) {
    return plainResponse("Method not allowed", 405, { Allow: route.methods.join(", ") });
  }

  if (pathname === "/") {
    return handlePublicSignup(request, _env, _ctx);
  }
  if (pathname === "/analytics/events") return handleAnalyticsEvent(request, _env, _ctx);
  if (pathname === "/connected") return handleConnected(request, _env);
  if (pathname === "/attribution/redeem") return handleRedeem(request, _env);
  if (pathname === "/health") {
    return healthResponse(_env);
  }
  if (pathname === "/router/fas/ad/start" || pathname === "/router/fas/ad/complete") {
    return handleAdGate(request, _env, pathname.endsWith("/complete"));
  }
  if (/^\/router\/fas\/wait\/[^/]+$/u.test(pathname)) return handleWaitingPage(request, _env);
  const showcaseAsset = SHOWCASE_ASSETS[pathname];
  if (showcaseAsset) {
    return showcaseImageResponse(request.method, showcaseAsset);
  }
  if (pathname === "/router/bootstrap" && request.method === "POST") {
    return handleBootstrap(request, _env);
  }

  if (pathname === "/router/fas" && request.method === "GET") {
    return handleFasPage(request, _env);
  }
  if (
    (pathname === "/router/fas" || pathname === "/router/fas/submit") &&
    request.method === "POST"
  ) {
    return pathname === "/router/fas"
      ? handleAuthmon(request, _env, _ctx)
      : handleFasSubmit(request, _env, _ctx);
  }
  if (/^\/router\/fas\/status\/[^/]+$/u.test(pathname) && request.method === "GET") {
    return handleFasStatus(request, _env);
  }
  if (pathname === "/notice" && request.method === "GET") {
    return secureHtml(renderNoticePage());
  }
  if (pathname === "/preview" && request.method === "GET") {
    return secureHtml(renderPreviewPage(), 200, { "X-Robots-Tag": "noindex, nofollow" });
  }
  if (pathname === "/preview/test") {
    return handleTeamTest(request, _env);
  }
  if (pathname === "/preview/data" && request.method === "GET") {
    return handleTeamTestData(request, _env);
  }
  if (pathname === "/preview/connecting" && request.method === "GET") {
    return secureHtml(renderConnectingPreviewPage(), 200, {
      "X-Robots-Tag": "noindex, nofollow"
    });
  }
  if (pathname === "/preview/connected" && request.method === "GET") {
    return secureHtml(renderConnectedPage(), 200, {
      "X-Robots-Tag": "noindex, nofollow"
    });
  }

  return plainResponse("Not implemented", 501);
}
