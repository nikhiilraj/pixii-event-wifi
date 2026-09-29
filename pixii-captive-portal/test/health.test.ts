import { createExecutionContext, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

beforeEach(async () => {
  await env.DB.prepare("SELECT 1").run();
});

describe("health", () => {
  it("checks D1 and returns only the public healthy shape", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/health"),
      env as Env,
      createExecutionContext()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("returns only a generic unhealthy shape when D1 fails", async () => {
    const failingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") return () => { throw new Error("database pixii-secret failed"); };
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/health"),
      { ...(env as Env), DB: failingDb },
      createExecutionContext()
    );
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: false });
    expect(body).not.toContain("pixii-secret");
  });

  it("does not expose deployment or database metadata", async () => {
    const response = await worker.fetch(
      new Request("https://wifi.pixii.ai/health"),
      env as Env,
      createExecutionContext()
    );
    const text = await response.text();
    expect(text).not.toMatch(/account|database|rows|version|commit|9423b9/iu);
  });
});
