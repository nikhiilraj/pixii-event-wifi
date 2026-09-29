// Read-only by default. --submit-test adds one clearly labelled team-test lead.
import assert from "node:assert/strict";
const base = new URL(process.argv[2] || "https://wifi.pixii.ai");
if (!['https://wifi.pixii.ai', 'https://wifi.joinpixii.com'].includes(base.origin)) throw new Error("Use a verified Wi-Fi production hostname.");
async function get(path) {
  const response = await fetch(new URL(path, base), { redirect: "manual" });
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get("location"), null);
  return response;
}
const preview = await (await get("/preview/connecting")).text();
assert.ok(preview.includes("Fly By Jing Electric Chengdu Street Heat"));
assert.ok(preview.includes('id="ad-countdown">7'));
for (const file of ["listing-hero.webp", "aplus-mobile.webp", "showcase.mp4", "experience-v3.js"]) {
  const asset = await get("/assets/flybyjing/v1/" + file);
  assert.ok((await asset.arrayBuffer()).byteLength > 1000);
}
console.log("PASS: full-screen page and same-domain artwork/video/script.");

if (process.argv.includes("--submit-test")) {
  const form = await fetch(new URL("/preview/test", base), {
    method: "POST", headers: { Origin: base.origin },
    body: new URLSearchParams({ fullName: "Fly By Jing RELEASE TEST - Codex", email: "flybyjing-release-test@example.com", phoneCountry: "US", phone: "4155550123", consent: "accepted" })
  });
  assert.equal(form.status, 201);
  const html = await form.text();
  const endpoint = JSON.parse(html.match(/const endpoint=("[^"\n]+");/)[1]);
  const statusUrl = new URL(endpoint, base);
  const registrationId = decodeURIComponent(statusUrl.pathname.split("/").at(-1));
  const body = { registrationId, token: statusUrl.searchParams.get("token"), visibleMs: 0 };
  async function post(action, visibleMs) {
    return fetch(new URL("/router/fas/ad/" + action, base), {
      method: "POST", headers: { Origin: base.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, visibleMs })
    });
  }
  const started = await post("start", 0);
  assert.equal(started.status, 200);
  assert.equal((await post("complete", 7000)).status, 425);
  assert.deepEqual(await (await get(endpoint)).json(), { status: "pending" });
  await new Promise(resolve => setTimeout(resolve, 7100));
  assert.equal((await post("complete", 7000)).status, 200);
  assert.equal((await post("complete", 7000)).status, 200);
  assert.deepEqual(await (await get(endpoint)).json(), { status: "connected" });
  console.log("PASS: signed start, early-completion rejection, seven-second completion, idempotent retry and connected status.");
  console.log("Team-test registration saved:", registrationId);
}
