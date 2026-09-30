import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";
import { createVisit, enqueueEvent, flushOutbox, reconcileAnalytics, trackingAllowed } from "../src/analytics";
import vector from "./fixtures/opennds-level3-v10.3.json";
import { signContext } from "../src/analytics";
import { issueHandoff, cleanFinalResponse, hasSafePixelReferrer } from "../src/tracking-http";

it("never enables vendors when a legacy session URL survives as the clean document referrer", () => {
  for (const referrer of ["", "https://wifi.pixii.ai/", "https://wifi.pixii.ai/connected"]) {
    expect(hasSafePixelReferrer(new Request("https://wifi.pixii.ai/connected", {headers:{Referer:referrer}}))).toBe(true);
  }
  for (const referrer of ["https://wifi.pixii.ai/router/fas/wait/id?token=synthetic", "https://wifi.pixii.ai/connected?token=synthetic", "https://other.example/", "invalid"]) {
    expect(hasSafePixelReferrer(new Request("https://wifi.pixii.ai/connected", {headers:{Referer:referrer}}))).toBe(false);
  }
});

const origin = "https://wifi.pixii.ai";
const appEnv = { ...env, ANALYTICS_ENABLED: "true", ANALYTICS_ROLLOUT_AT: "2026-09-30T00:00:00.000Z", PRIVACY_US_REVIEWED: "true" } as Env;
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM analytics_outbox"), env.DB.prepare("DELETE FROM attribution_handoffs"), env.DB.prepare("DELETE FROM analytics_visits")]);
  await env.DB.batch([env.DB.prepare("DELETE FROM auth_queue"), env.DB.prepare("DELETE FROM registrations"),env.DB.prepare("DELETE FROM bootstrap_tokens"),env.DB.prepare("DELETE FROM routers"),env.DB.prepare("DELETE FROM events")]);
  await env.DB.prepare("INSERT INTO events VALUES('evt_sf','sf','SF','America/Los_Angeles','2026-09-01','2030-01-01',365,'2026-09-01')").run();
  await env.DB.prepare("INSERT INTO routers VALUES('rtr_puli','evt_sf','gl-xe3000-stock-v1',?,?,1,'2026-09-01','2026-09-01')").bind(vector.fields.gatewayname,vector.gatewayHash).run();
});
async function get(path = "/", headers = {}) {
  return worker.fetch(new Request(origin + path, { headers, cf: { country: "US" } }), appEnv, createExecutionContext());
}

it("does not accept success assertions from browser telemetry", async () => {
  const response = await worker.fetch(new Request(origin + "/analytics/events", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ event: "wifi_connected" })
  }), appEnv, createExecutionContext());
  expect(response.status).toBe(403);
});

it("a clean final screen without a verified session never loads pixels", async () => {
  const response = await get("/connected");
  expect(response.status).toBe(403);
  expect(response.headers.get("Content-Security-Policy")).not.toContain("facebook");
});

it("rejects cross-origin attribution redemption before touching a token", async () => {
  const response = await worker.fetch(new Request(origin + "/attribution/redeem", {
    method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}"
  }), appEnv, createExecutionContext());
  expect(response.status).toBe(403);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
});

it("keeps stable event IDs/timestamps on duplicate enqueue and failed delivery, without personal data", async () => {
  const visit = await createVisit(new Request(origin, { cf: { country: "US" } }), appEnv, "wifi");
  expect(visit).not.toBeNull();
  await enqueueEvent(appEnv, visit!.id, "wifi_form_viewed", "2026-09-30T01:02:03.000Z");
  await enqueueEvent(appEnv, visit!.id, "wifi_form_viewed", "2026-09-30T02:02:03.000Z");
  const sent: unknown[] = [];
  const fail = async (_input: RequestInfo | URL, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response("", { status: 503 }); };
  await flushOutbox({ ...appEnv, POSTHOG_PROJECT_TOKEN: "synthetic-test" }, fail);
  const pending = await env.DB.prepare("SELECT * FROM analytics_outbox").all();
  expect(pending.results).toHaveLength(1);
  expect(pending.results[0]).toMatchObject({ occurred_at: "2026-09-30T01:02:03.000Z", delivered_at: null, attempts: 1 });
  await env.DB.prepare("UPDATE analytics_outbox SET next_attempt_at = 0").run();
  await flushOutbox({ ...appEnv, POSTHOG_PROJECT_TOKEN: "synthetic-test" }, async (_input, init) => { sent.push(JSON.parse(String(init?.body))); return new Response("1"); });
  expect(sent[0]).toEqual(sent[1]);
  expect(JSON.stringify(sent)).not.toMatch(/full_name|email|phone|gateway|rhid|registration_id|\$current_url|token=/);
  expect(await env.DB.prepare("SELECT delivered_at FROM analytics_outbox").first("delivered_at")).not.toBeNull();
});

it("suppresses unknown jurisdictions, GPC, recorded opt-outs and disabled tracking", () => {
  expect(trackingAllowed(new Request(origin), appEnv)).toBe(false);
  expect(trackingAllowed(new Request(origin, { cf: { country: "US" }, headers: { "Sec-GPC": "1" } }), appEnv)).toBe(false);
  expect(trackingAllowed(new Request(origin, { cf: { country: "US" }, headers: { Cookie: "pixii_tracking_opt_out=1" } }), appEnv)).toBe(false);
  expect(trackingAllowed(new Request(origin, { cf: { country: "US" } }), { ...appEnv, ANALYTICS_ENABLED: "false" })).toBe(false);
});

it("never creates production visits for previews or team tests", async () => {
  expect(await createVisit(new Request(origin + "/preview/test", { cf: { country: "US" } }), appEnv, "team_test")).toBeNull();
  expect(await createVisit(new Request(origin + "/preview", { cf: { country: "US" } }), appEnv, "wifi")).toBeNull();
});

async function publicSignup() {
  const html = await (await get()).text();
  const context = html.match(/name="analyticsContext" value="([^"]+)"/)?.[1];
  expect(context).toBeTruthy();
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(origin, { method: "POST", cf: { country: "US" },
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ fullName: "Synthetic Test", email: "synthetic@example.com", phoneCountry: "US", phone: "4155550123", consent: "accepted", analyticsContext: context! })
  }), appEnv, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

it("recovers a saved signup from an interrupted outbox write, never turns public web into Wi-Fi connected", async () => {
  expect((await publicSignup()).status).toBe(201);
  await env.DB.prepare("DELETE FROM analytics_outbox").run();
  await reconcileAnalytics(appEnv);
  await reconcileAnalytics(appEnv);
  expect((await env.DB.prepare("SELECT event FROM analytics_outbox").all()).results).toEqual([{ event: "wifi_signup_completed" }]);
});

it("rejects clean final access before the ad gate, then renders identical final design without router data", async () => {
  const submitted = await publicSignup();
  const waiting = await submitted.text();
  const id = await env.DB.prepare("SELECT id FROM registrations").first<string>("id");
  const cookie = "__Host-pixii_connected=" + await signContext({ kind: "connected_session", id, expires: Date.now()+120000 },appEnv);
  expect((await get("/connected", { Cookie: cookie })).status).toBe(403);
  await env.DB.prepare("UPDATE registrations SET ad_started_at=?,ad_completed_at=?,ad_visible_ms=7000").bind(Date.now()-8000,Date.now()).run();
  const clean = await get("/connected", { Cookie: cookie });
  expect(clean.status).toBe(200);
  const html = await clean.text();
  expect(html).toContain("Design my listing");
  expect(html).not.toContain(id!);
  expect(html).not.toMatch(/window.pixiiAd|registrationId|\/router\/fas\/status|\"token\":/);
  expect(html).not.toContain(vector.key);
  expect(clean.headers.get("Content-Security-Policy")).not.toContain("facebook");
});

it("redeems only once and propagates suppression instead of an identity", async () => {
  const visit = (await createVisit(new Request(origin, { cf: { country: "US" } }),appEnv,"wifi"))!;
  const token = await issueHandoff(appEnv,visit);
  const redeem = (optOut = false) => worker.fetch(new Request(origin + "/attribution/redeem", { method: "POST", cf: { country: "US" },
    headers: { Origin: "https://www.pixii.ai", "Content-Type": "application/json" }, body: JSON.stringify({ token,optOut }) }), appEnv,createExecutionContext());
  expect(await (await redeem(true)).json()).toEqual({ suppressed: true });
  expect((await redeem()).status).toBe(410);
  expect(await env.DB.prepare("SELECT suppressed FROM analytics_visits WHERE id=?").bind(visit.id).first("suppressed")).toBe(1);
});

it("an outbox failure never rolls back successful signup and recovery uses the original save time", async () => {
  await env.DB.exec("CREATE TRIGGER fail_analytics BEFORE INSERT ON analytics_outbox BEGIN SELECT RAISE(FAIL, 'synthetic outage'); END;");
  try {
    expect((await publicSignup()).status).toBe(201);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM registrations").first("n")).toBe(1);
  } finally { await env.DB.exec("DROP TRIGGER fail_analytics;"); }
  await reconcileAnalytics(appEnv);
  const created = await env.DB.prepare("SELECT created_at FROM registrations").first("created_at");
  expect(await env.DB.prepare("SELECT occurred_at FROM analytics_outbox").first("occurred_at")).toBe(created);
});

it("a browser-local opt-out cannot enroll a registration even before its telemetry reaches the server", async () => {
  const html = await (await get()).text();
  const context = html.match(/name="analyticsContext" value="([^"]+)"/)?.[1];
  const response = await worker.fetch(new Request(origin, { method: "POST", cf: { country:"US" }, headers: { Origin:origin,"Content-Type":"application/x-www-form-urlencoded" },
    body: new URLSearchParams({fullName:"Synthetic Test",email:"synthetic@example.com",phoneCountry:"US",phone:"4155550123",consent:"accepted",analyticsContext:context!,analyticsOptOut:"1"}) }),appEnv,createExecutionContext());
  expect(response.status).toBe(201);
  expect(await env.DB.prepare("SELECT analytics_visit_id FROM registrations").first("analytics_visit_id")).toBeNull();
});

it("bounded analytics event input rejects extra personal fields and wrong page context", async () => {
  const html = await (await get()).text();
  const context = html.match(/name="analyticsContext" value="([^"]+)"/)?.[1];
  const post = (body: Record<string,unknown>) => worker.fetch(new Request(origin+"/analytics/events",{method:"POST",cf:{country:"US"},headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)}),appEnv,createExecutionContext());
  expect((await post({event:"wifi_form_viewed",context,email:"never-send@example.com"})).status).toBe(400);
  expect((await post({event:"wifi_pixii_open_requested",context,method:"click"})).status).toBe(403);
});

it("times out a stalled optional visit write without delaying the signup page indefinitely", async () => {
  const stalled = new Proxy(env.DB,{get(target,property){
    if(property === "prepare")return (sql:string)=>sql.startsWith("INSERT INTO analytics_visits")
      ? {bind:()=>({run:()=>new Promise(()=>{})})} : target.prepare(sql);
    const value=Reflect.get(target,property,target);return typeof value === "function"?value.bind(target):value;
  }});
  const response = await worker.fetch(new Request(origin,{cf:{country:"US"}}),{...appEnv,DB:stalled},createExecutionContext());
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('id="signup-form"');
}, 1500);

it("a stalled clean-page eligibility check preserves the confirmed connection response", async () => {
  const stalled = { prepare: () => ({ bind: () => ({ first: () => new Promise(() => {}) }) }) } as unknown as D1Database;
  const response = new Response(JSON.stringify({status:"connected"}));
  expect(await cleanFinalResponse(response,{...appEnv,DB:stalled},crypto.randomUUID())).toBe(response);
},1500);

it("rejects expired handoff and page contexts and bounds payloads", async () => {
  const visit = (await createVisit(new Request(origin,{cf:{country:"US"}}),appEnv,"wifi"))!;
  const token = await issueHandoff(appEnv,visit);
  await env.DB.prepare("UPDATE attribution_handoffs SET expires_at=0").run();
  const redeem = await worker.fetch(new Request(origin+"/attribution/redeem",{method:"POST",cf:{country:"US"},headers:{Origin:"https://www.pixii.ai","Content-Type":"application/json"},body:JSON.stringify({token})}),appEnv,createExecutionContext());
  expect(redeem.status).toBe(410);
  const context = await signContext({kind:"form",visit:visit.id,source:"wifi",expires:Date.now()-1},appEnv);
  const send = (body: string) => worker.fetch(new Request(origin+"/analytics/events",{method:"POST",cf:{country:"US"},headers:{Origin:origin,"Content-Type":"application/json"},body}),appEnv,createExecutionContext());
  expect((await send(JSON.stringify({event:"wifi_form_viewed",context}))).status).toBe(403);
  expect((await send(JSON.stringify({context:"a".repeat(3000)}))).status).toBe(413);
});
