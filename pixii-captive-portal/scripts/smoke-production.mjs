#!/usr/bin/env node

function fail(message) {
  throw new Error(`Production smoke check failed: ${message}`);
}

function assertSecurityHeaders(response) {
  if (response.headers.get("x-content-type-options") !== "nosniff") fail("missing nosniff");
  if (response.headers.get("referrer-policy") !== "no-referrer") fail("wrong referrer policy");
  if (response.headers.get("cache-control") !== "no-store") fail("dynamic response is cacheable");
  const policy = response.headers.get("content-security-policy") ?? "";
  if (!policy.includes("default-src 'none'") || !policy.includes("frame-ancestors 'none'")) {
    fail("content security policy is incomplete");
  }
  const server = response.headers.get("server") ?? "";
  if (/[\d/]/u.test(server)) fail("server header exposes version detail");
}

function assertNoSecrets(text) {
  if (/fas[_-]?key|bootstrap[_-]?token|BEGIN (?:RSA |EC )?PRIVATE KEY|password\s*[:=]/iu.test(text)) {
    fail("response contains a secret-like string");
  }
}

async function main() {
  if (process.argv.length !== 3) fail("usage: smoke-production.mjs https://hostname");
  const base = new URL(process.argv[2]);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    fail("base URL must be a plain HTTPS origin");
  }
  base.pathname = "/";

  const health = await fetch(new URL("/health", base), { redirect: "manual" });
  assertSecurityHeaders(health);
  if (health.status !== 200 || JSON.stringify(await health.json()) !== JSON.stringify({ ok: true })) {
    fail("health endpoint is not ready");
  }

  const notice = await fetch(new URL("/notice", base), { redirect: "manual" });
  assertSecurityHeaders(notice);
  if (notice.status !== 200) fail("notice endpoint is unavailable");
  const noticeText = await notice.text();
  assertNoSecrets(noticeText);
  if (/<(?:img|script|link)\b[^>]*(?:src|href)=["']https?:/iu.test(noticeText)) {
    fail("notice uses a third-party browser asset");
  }
  if (!noticeText.includes("365 days") || !noticeText.includes("Privacy Policy")) {
    fail("notice copy is incomplete");
  }

  const wrongMethod = await fetch(new URL("/health", base), {
    method: "POST",
    redirect: "manual"
  });
  assertSecurityHeaders(wrongMethod);
  if (wrongMethod.status !== 405 || wrongMethod.headers.get("allow") !== "GET") {
    fail("health method boundary is incorrect");
  }
  assertNoSecrets(await wrongMethod.text());

  const missing = await fetch(new URL("/smoke-not-found", base), { redirect: "manual" });
  assertSecurityHeaders(missing);
  if (missing.status !== 404) fail("unknown path did not return 404");
  assertNoSecrets(await missing.text());

  process.stdout.write("Production smoke check passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Production smoke check failed."}\n`);
  process.exitCode = 1;
});
