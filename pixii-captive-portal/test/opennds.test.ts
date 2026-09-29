import { describe, expect, it } from "vitest";
import vector from "./fixtures/opennds-level3-v10.3.json";
import {
  buildAuthRecord,
  decryptFasPayload,
  encodeAuthList,
  gatewayHash,
  parseAckPayload,
  parseFasFields,
  returnHash,
  signFormState,
  verifyFormState
} from "../src/opennds";

const registrationId = "018f2c4e-8b4a-7d11-a834-3f845e34d921";
const formSigningKey = "test-form-signing-key-with-at-least-32-bytes";
const now = 1_800_000_000_000;

describe("openNDS level-3 FAS compatibility", () => {
  it("decrypts the official v10.3 double-base64 payload vector", async () => {
    await expect(decryptFasPayload(vector.fas, vector.iv, vector.key)).resolves.toBe(
      vector.plaintext
    );
  });

  it("rejects a wrong key without exposing OpenSSL details", async () => {
    await expect(
      decryptFasPayload(vector.fas, vector.iv, "x".repeat(64))
    ).rejects.toThrow("Invalid captive portal payload.");
  });

  it.each([
    ["not base64!", vector.iv],
    [vector.fas, "too-short"],
    [vector.fas, "0123456789abcdefx"]
  ])("rejects malformed ciphertext or IV", async (fas, iv) => {
    await expect(decryptFasPayload(fas, iv, vector.key)).rejects.toThrow(
      "Invalid captive portal payload."
    );
  });

  it("rejects ciphertext over the 8 KiB encoded limit", async () => {
    await expect(
      decryptFasPayload("A".repeat(8_193), vector.iv, vector.key)
    ).rejects.toThrow("Invalid captive portal payload.");
  });

  it("parses only allowlisted fields from the decrypted payload", () => {
    expect(parseFasFields(vector.plaintext, vector.fields.gatewayname)).toEqual(vector.fields);
  });

  it.each(["", ", "])("accepts the confirmed four-null custom-field suffix (trailing %j)", (trailing) => {
    expect(parseFasFields(`${vector.plaintext}, (null)(null)(null)(null)${trailing}`, vector.fields.gatewayname)).toEqual(vector.fields);
  });

  it.each([
    "(null)", "(null)(null)", "(null)(null)(null)", "(null)(null)(null)(null)(null)",
    "(NULL)(NULL)(NULL)(NULL)", " (null)(null)(null)(null)", "(null)(null)(null)(null) ",
    "(null)(null)(null)(null)extra", "(null)(null)(null)(null), themespec=",
    "(null)(null)(null)(null), (null)(null)(null)(null)", ", (null)(null)(null)(null)",
    "(null)(null)(null)(null), , "
  ])("still rejects a non-exact or non-terminal custom-field fragment (%j)", (fragment) => {
    expect(() => parseFasFields(`${vector.plaintext}, ${fragment}`)).toThrow("Invalid captive portal payload.");
  });

  it("preserves placeholder text inside a normal field value", () => {
    expect(parseFasFields(`${vector.plaintext}, themespec=(null)(null)(null)(null)`).themespec).toBe("(null)(null)(null)(null)");
  });

  it("does not turn a payload containing only placeholders into a valid request", () => {
    expect(() => parseFasFields("(null)(null)(null)(null)")).toThrow("Invalid captive portal payload.");
  });

  it.each([
    [`${vector.plaintext}, hid=${vector.fields.hid}`, "duplicate hid"],
    [vector.plaintext.replace(/, gatewayname=[^,]+/u, ""), "missing gateway"],
    [vector.plaintext.replace(vector.fields.gatewayname, "unknown-router"), "unknown gateway"],
    [`${vector.plaintext}\n`, "control character"],
    [`${vector.plaintext}, secret=leak`, "unrecognized field"],
    [`${vector.plaintext}, themespec=none, themespec=`, "duplicate optional metadata"],
    [`${vector.plaintext}, , `, "multiple trailing separators"],
    [vector.plaintext.replace(", gatewayname=", ", , gatewayname="), "interior empty field"],
    [vector.plaintext.replace(vector.fields.hid, vector.fields.hid.slice(0, 32)), "short client HID"],
    [vector.plaintext.replace(vector.fields.gatewayname, ""), "empty gateway"],
    [`${vector.plaintext}, authdir=`, "empty non-theme metadata"]
  ])("rejects hostile FAS fields: %s", (plaintext) => {
    expect(() => parseFasFields(plaintext, vector.fields.gatewayname)).toThrow(
      "Invalid captive portal payload."
    );
    // The compatibility suffix must not bypass any existing field check.
    expect(() => parseFasFields(`${plaintext}, (null)(null)(null)(null)`, vector.fields.gatewayname)).toThrow(
      "Invalid captive portal payload."
    );
  });
});

describe("openNDS Authmon protocol", () => {
  it("calculates exact gateway and return hashes", async () => {
    await expect(gatewayHash(vector.fields.gatewayname)).resolves.toBe(vector.gatewayHash);
    await expect(returnHash(vector.fields.hid, vector.key)).resolves.toBe(vector.rhid);
  });

  it("builds the exact Authmon record", async () => {
    await expect(buildAuthRecord(vector.fields.hid, vector.key, registrationId)).resolves.toBe(
      `${vector.rhid} 480 5000 20000 0 0 MDE4ZjJjNGUtOGI0YS03ZDExLWE4MzQtM2Y4NDVlMzRkOTIx`
    );
  });

  it("percent-encodes each record and emits the empty sentinel", () => {
    const record = `${vector.rhid} 480 5000 20000 0 0 abc+/=`;
    expect(encodeAuthList([])).toBe("*");
    expect(encodeAuthList([record, "second record"])).toBe(
      `* ${encodeURIComponent(record)} ${encodeURIComponent("second record")}`
    );
  });

  it("parses base64 acknowledgement payloads and the none sentinel", () => {
    expect(parseAckPayload(btoa("none"))).toEqual([]);
    expect(parseAckPayload(btoa(`* ${vector.rhid} ${vector.rhid}`))).toEqual([vector.rhid]);
  });

  it.each([
    "not base64!",
    btoa("* not-a-return-hash"),
    btoa("missing-star " + vector.rhid),
    btoa("* " + "a".repeat(2_049))
  ])("rejects malformed or oversized acknowledgement payloads", (payload) => {
    expect(() => parseAckPayload(payload)).toThrow("Invalid Authmon acknowledgement.");
  });
});

describe("signed form state", () => {
  it("binds an unexpired state token to the FAS payload, IV, and gateway", async () => {
    const token = await signFormState(
      vector.fas,
      vector.iv,
      vector.fields.gatewayname,
      now + 5 * 60_000,
      formSigningKey
    );

    await expect(
      verifyFormState(
        token,
        vector.fas,
        vector.iv,
        vector.fields.gatewayname,
        now,
        formSigningKey
      )
    ).resolves.toEqual({ gatewayName: vector.fields.gatewayname, expiresAt: now + 5 * 60_000 });
  });

  it("rejects expired, overlong, and tampered state", async () => {
    const expired = await signFormState(
      vector.fas,
      vector.iv,
      vector.fields.gatewayname,
      now - 1,
      formSigningKey
    );
    const overlong = await signFormState(
      vector.fas,
      vector.iv,
      vector.fields.gatewayname,
      now + 10 * 60_000 + 1,
      formSigningKey
    );
    const valid = await signFormState(
      vector.fas,
      vector.iv,
      vector.fields.gatewayname,
      now + 60_000,
      formSigningKey
    );

    await expect(
      verifyFormState(expired, vector.fas, vector.iv, vector.fields.gatewayname, now, formSigningKey)
    ).rejects.toThrow("Invalid form state.");
    await expect(
      verifyFormState(overlong, vector.fas, vector.iv, vector.fields.gatewayname, now, formSigningKey)
    ).rejects.toThrow("Invalid form state.");
    await expect(
      verifyFormState(valid, `${vector.fas}A`, vector.iv, vector.fields.gatewayname, now, formSigningKey)
    ).rejects.toThrow("Invalid form state.");
    await expect(
      verifyFormState(valid, vector.fas, `${vector.iv}x`, vector.fields.gatewayname, now, formSigningKey)
    ).rejects.toThrow("Invalid form state.");
    await expect(
      verifyFormState(valid, vector.fas, vector.iv, "another-gateway", now, formSigningKey)
    ).rejects.toThrow("Invalid form state.");
    await expect(
      verifyFormState(valid.slice(0, -1) + "A", vector.fas, vector.iv, vector.fields.gatewayname, now, formSigningKey)
    ).rejects.toThrow("Invalid form state.");
  });
});
