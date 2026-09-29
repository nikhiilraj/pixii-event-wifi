import assert from "node:assert/strict";
import test from "node:test";

import { onRequest } from "../functions/[[path]].js";

test("forwards the complete request to the captive portal Worker", async () => {
  const request = new Request("https://wifi.pixii.ai/router/bootstrap?device=test", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pixii-test": "gateway",
    },
    body: JSON.stringify({ hello: "world" }),
  });

  let forwardedRequest;
  const portal = {
    async fetch(receivedRequest) {
      forwardedRequest = receivedRequest;
      return new Response("forwarded", { status: 202 });
    },
  };

  const response = await onRequest({
    request,
    env: { PORTAL: portal },
  });

  assert.equal(response.status, 202);
  assert.equal(await response.text(), "forwarded");
  assert.equal(forwardedRequest, request);
  assert.equal(forwardedRequest.url, request.url);
  assert.equal(forwardedRequest.headers.get("x-pixii-test"), "gateway");
  assert.deepEqual(await forwardedRequest.json(), { hello: "world" });
});

test("fails clearly when the Worker service binding is unavailable", async () => {
  const request = new Request("https://wifi.pixii.ai/health");

  const response = await onRequest({ request, env: {} });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Portal service unavailable",
  });
});
