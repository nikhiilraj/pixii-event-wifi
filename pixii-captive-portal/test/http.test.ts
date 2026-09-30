import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;

describe("HTTP boundary", () => {
  it("serves new progress runtimes and Bloom media through the same-domain asset boundary", async () => {
    for (const [path, type] of [
      ["/assets/connected-v1.js", "javascript"],
      ["/assets/connected-v2.js", "javascript"],
      ["/assets/connected-v3.js", "javascript"],
      ["/assets/flybyjing/v1/experience-v4.js", "javascript"],
      ["/assets/flybyjing/v1/experience-v5.js", "javascript"],
      ["/assets/flybyjing/v1/experience-v6.js", "javascript"],
      ["/assets/app-theme/v1/CabinetGrotesk-Medium.woff2", "font/woff2"],
      ["/assets/app-theme/v1/Switzer-Regular.woff2", "font/woff2"],
      ["/assets/app-theme/v1/Switzer-Medium.woff2", "font/woff2"],
      ["/assets/bloom/v1/video-poster.webp", "image/webp"],
      ["/assets/bloom/v1/showcase.mp4", "video/mp4"]
    ]) {
      const response = await worker.fetch(new Request(`https://wifi.pixii.ai${path}`), testEnv, createExecutionContext());
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(type);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      const post = await worker.fetch(new Request(`https://wifi.pixii.ai${path}`, { method: "POST" }), testEnv, createExecutionContext());
      expect(post.status).toBe(405);
    }
  });
  it("serves self-hosted Fly By Jing artwork and video without a redirect", async () => {
    for (const path of ["listing-hero.webp", "aplus-mobile.webp", "video-poster.webp"]) {
      const response = await worker.fetch(new Request(`https://wifi.pixii.ai/assets/flybyjing/v1/${path}`), testEnv, createExecutionContext());
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/webp");
      expect(response.headers.get("location")).toBeNull();
    }
    const video = await worker.fetch(new Request("https://wifi.pixii.ai/assets/flybyjing/v1/showcase.mp4", { headers: { Range: "bytes=0-1023" } }), testEnv, createExecutionContext());
    // The local assets emulator can return the full file for a Range request.
    expect([200, 206]).toContain(video.status);
    expect(video.headers.get("content-type")).toContain("video/mp4");
    const bytes = (await video.arrayBuffer()).byteLength;
    expect(video.status === 206 ? bytes === 1024 : bytes > 1024).toBe(true);
  });
  it("serves the working public signup form directly at the custom-domain root", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/"),
      testEnv,
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    const html = await response.text();
    expect(html).toContain('action="/"');
    expect(html).not.toContain('class="preview-banner"');
    expect(html).not.toContain('class="team-note"');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a non-secret health response with fixed headers", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/health"),
      testEnv,
      ctx
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
  });

  it("returns 405 for a known route with the wrong method", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/router/bootstrap"),
      testEnv,
      createExecutionContext()
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("returns 404 without reflecting an unknown path", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/%3Cscript%3Ealert(1)%3C/script%3E"),
      testEnv,
      createExecutionContext()
    );

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("<script>");
  });

  it("serves the collection notice without a separate sale/share approval dependency", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/notice"),
      testEnv,
      createExecutionContext()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Notice at Collection");
    expect(html).toContain('href="https://www.pixii.ai/privacy/"');
    expect(html).not.toContain("Sale or sharing");
  });

  it("serves a safe public form preview that cannot submit guest details", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/preview"),
      testEnv,
      createExecutionContext()
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(html).toContain("Form preview");
    expect(html.replace(/<[^>]*>/gu, "")).toContain("Get free, fast Wi-Fi.");
    expect(html).toContain("Wi-Fi powered by");
    expect(html).toContain('name="fullName"');
    expect(html).toContain('name="consent"');
    expect(html).toContain('type="button"');
    expect(html).not.toContain("/router/fas/submit");
    expect(html).not.toContain("<form");
  });

  it("serves the complete Dr. Squatch example locally with immutable caching", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/assets/dr-squatch-complete-listing.webp"),
      testEnv,
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(30_000);
  });

  it("does not expose the removed Stanley or Premium A+ assets", async () => {
    const stanleyResponse = await worker.fetch(
      new Request("https://wifi.pixii.ai/assets/stanley-one-to-seven.webp"),
      testEnv,
      createExecutionContext()
    );
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/assets/stanley-premium-aplus.webp"),
      testEnv,
      createExecutionContext()
    );
    expect(stanleyResponse.status).toBe(404);
    expect(response.status).toBe(404);
  });

  it("rejects POST requests to the public form preview", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/preview", { method: "POST" }),
      testEnv,
      createExecutionContext()
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
