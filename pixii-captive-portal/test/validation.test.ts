import { describe, expect, it } from "vitest";
import {
  RequestParseError,
  parseBody,
  validateBootstrapRequest,
  validateSignup
} from "../src/validation";

const validInput = {
  fullName: "Ada Lovelace",
  email: "Ada@Example.com",
  phoneCountry: "US",
  phone: "(415) 555-0123",
  consent: "accepted"
};

describe("validateSignup", () => {
  it("trims Unicode names and preserves the entered email", () => {
    expect(validateSignup({ ...validInput, fullName: "  José 李  " })).toEqual({
      ok: true,
      value: {
        fullName: "José 李",
        email: "Ada@Example.com",
        emailNormalized: "ada@example.com",
        phoneCountry: "US",
        phoneE164: "+14155550123",
        consentEmailMarketing: true
      }
    });
  });

  it.each([
    ["A", "too short"],
    ["a".repeat(101), "too long"],
    ["Ada\nLovelace", "control character"]
  ])("rejects a name that is %s", (fullName) => {
    expect(validateSignup({ ...validInput, fullName })).toMatchObject({
      ok: false,
      errors: { fullName: expect.any(String) }
    });
  });

  it.each([
    "missing-at.example.com",
    "a@localhost",
    `a@${"b".repeat(250)}.com`,
    "ada@example.com\u0085"
  ])("rejects malformed email %s", (email) => {
    expect(validateSignup({ ...validInput, email })).toMatchObject({
      ok: false,
      errors: { email: expect.any(String) }
    });
  });

  it.each(["(415) 555-0123", "415-555-0123", "+14155550123"])(
    "normalizes US phone %s",
    (phone) => {
      expect(validateSignup({ ...validInput, phone })).toMatchObject({
        ok: true,
        value: { phoneCountry: "US", phoneE164: "+14155550123" }
      });
    }
  );

  it("normalizes a national number using the selected country", () => {
    expect(validateSignup({
      ...validInput,
      phoneCountry: "GB",
      phone: "020 7183 8750"
    })).toMatchObject({
      ok: true,
      value: { phoneCountry: "GB", phoneE164: "+442071838750" }
    });
  });

  it.each([
    "115-555-0123",
    "415-055-0123",
    "415555012",
    "415-555-0123 x4"
  ])("rejects non-US or impossible phone %s", (phone) => {
    expect(validateSignup({ ...validInput, phone })).toMatchObject({
      ok: false,
      errors: { phone: expect.any(String) }
    });
  });

  it("rejects an unsupported country or a number from a different selected country", () => {
    expect(validateSignup({ ...validInput, phoneCountry: "ZZ" })).toMatchObject({
      ok: false,
      errors: { phoneCountry: expect.any(String) }
    });
    expect(validateSignup({ ...validInput, phone: "+442071838750" })).toMatchObject({
      ok: false,
      errors: { phone: expect.any(String) }
    });
  });

  it.each([undefined, "", "false", "true", "on", "1"])(
    "rejects consent value %s",
    (consent) => {
      expect(validateSignup({ ...validInput, consent })).toMatchObject({
        ok: false,
        errors: { consent: expect.any(String) }
      });
    }
  );
});

describe("parseBody", () => {
  it("parses JSON and form bodies", async () => {
    const json = new Request("https://wifi.pixii.ai/router/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "json" })
    });
    const form = new Request("https://wifi.pixii.ai/router/fas/submit", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "value=form"
    });

    await expect(parseBody(json, 100)).resolves.toEqual({ value: "json" });
    await expect(parseBody(form, 100)).resolves.toEqual({ value: "form" });
  });

  it("rejects an oversized body before parsing", async () => {
    const request = new Request("https://wifi.pixii.ai/router/fas/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: `{"value":"${"a".repeat(100)}"}`
    });

    await expect(parseBody(request, 32)).rejects.toMatchObject({
      status: 413,
      code: "body_too_large"
    });
  });

  it("cancels a chunked body as soon as it exceeds the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new Uint8Array(64).fill(97));
        controller.enqueue(new TextEncoder().encode('"}'));
      },
      cancel() {
        cancelled = true;
      }
    });
    const request = new Request("https://wifi.pixii.ai/router/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stream
    });

    await expect(parseBody(request, 32)).rejects.toMatchObject({
      status: 413,
      code: "body_too_large"
    });
    expect(cancelled).toBe(true);
  });

  it("cancels a body rejected by its declared content length", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      }
    });
    const request = new Request("https://wifi.pixii.ai/router/bootstrap", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "4097"
      },
      body: stream
    });

    await expect(parseBody(request, 4096)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it("returns a generic error for malformed JSON", async () => {
    const request = new Request("https://wifi.pixii.ai/router/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{secret-value"
    });

    await expect(parseBody(request, 100)).rejects.toMatchObject({
      status: 400,
      code: "invalid_body",
      message: "The request body is invalid."
    });
  });
});

describe("validateBootstrapRequest", () => {
  it("accepts only the exact bootstrap shape", () => {
    expect(validateBootstrapRequest({
      bootstrap_token: "TOKEN_0123456789_ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      installer_version: "1.0.0",
      profile_id: "gl-xe3000-stock-v1"
    })).toMatchObject({ ok: true });
  });

  it("rejects unknown fields and malformed values", () => {
    expect(validateBootstrapRequest({
      bootstrap_token: "short",
      installer_version: "version-one",
      profile_id: "wrong-profile",
      extra: "not allowed"
    })).toMatchObject({ ok: false });
  });
});
