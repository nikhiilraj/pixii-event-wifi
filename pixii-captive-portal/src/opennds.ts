import {
  constantTimeEqual,
  decodeBase64Strict,
  decodeBase64UrlStrict,
  encodeBase64,
  encodeBase64Url,
  hmacSha256,
  sha256Hex,
  utf8Bytes
} from "./crypto";
import { FasDiagnosticError, type FasFailureReason, type FasFieldFormat } from "./fas-diagnostics";

const INVALID_ACK = "Invalid Authmon acknowledgement.";
const INVALID_STATE = "Invalid form state.";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const RETURN_HASH = /^[a-f0-9]{64}$/u;
const ALLOWED_FIELDS = new Set([
  "hid",
  "gatewayname",
  "clientip",
  "clientmac",
  "client_type",
  "gatewayaddress",
  "gatewaymac",
  "originurl",
  "clientif",
  "gatewayurl",
  "version",
  "authdir",
  "themespec"
]);

export type FasFields = Partial<Record<
  | "clientip"
  | "clientmac"
  | "client_type"
  | "gatewayaddress"
  | "gatewaymac"
  | "originurl"
  | "clientif"
  | "gatewayurl"
  | "version"
  | "authdir"
  | "themespec",
  string
>> & { hid: string; gatewayname: string };

interface FormState {
  fasHash: string;
  ivHash: string;
  gatewayName: string;
  expiresAt: number;
}

function invalidPayload(reason: FasFailureReason, format?: FasFieldFormat): FasDiagnosticError {
  return new FasDiagnosticError(reason, format);
}

function fieldFormat(pair: string, isLast: boolean): FasFieldFormat {
  // Classify structure only. Never return the fragment or relax validation.
  switch (pair) {
    case "(null)": return isLast ? "null_suffix_1" : "null_fragment_elsewhere";
    case "(null)(null)": return isLast ? "null_suffix_2" : "null_fragment_elsewhere";
    case "(null)(null)(null)": return isLast ? "null_suffix_3" : "null_fragment_elsewhere";
    case "(null)(null)(null)(null)": return isLast ? "null_suffix_4" : "null_fragment_elsewhere";
    case "": return "empty_fragment";
    default: return pair.startsWith("=") ? "missing_field_name" : "missing_equals";
  }
}

function opensslAes256Key(passphrase: string): Uint8Array<ArrayBuffer> {
  const passphraseBytes = utf8Bytes(passphrase);
  const key = new Uint8Array(32);
  key.set(passphraseBytes.subarray(0, 32));
  return key;
}

export async function decryptFasPayload(fas: string, iv: string, key: string): Promise<string> {
  let reason: FasFailureReason = "payload_length";
  try {
    if (fas.length > 8_192) throw invalidPayload(reason);
    reason = "key_missing";
    if (key.length === 0) throw invalidPayload(reason);
    reason = "iv_length";
    const ivBytes = utf8Bytes(iv);
    if (ivBytes.byteLength !== 16) throw invalidPayload(reason);

    // openNDS 9.8/10.3 wrap PHP's base64-returning openssl_encrypt(options=0)
    // in a second base64_encode call before placing the value in the URL.
    reason = "outer_base64";
    const innerBase64Bytes = decodeBase64Strict(fas, 8_192);
    reason = "inner_utf8";
    const innerBase64 = new TextDecoder("utf-8", { fatal: true }).decode(innerBase64Bytes);
    reason = "inner_base64";
    const ciphertext = decodeBase64Strict(innerBase64, 8_192);
    reason = "ciphertext_length";
    if (ciphertext.byteLength === 0 || ciphertext.byteLength % 16 !== 0) throw invalidPayload(reason);

    reason = "key_import";
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      opensslAes256Key(key),
      { name: "AES-CBC" },
      false,
      ["decrypt"]
    );
    reason = "decrypt_failed";
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: ivBytes },
      cryptoKey,
      ciphertext
    );
    reason = "plaintext_utf8";
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw invalidPayload(reason);
  }
}

export function parseFasFields(plaintext: string, expectedGatewayName?: string): FasFields {
  try {
    if (plaintext.length === 0 || plaintext.length > 8_192 || CONTROL_CHARACTERS.test(plaintext)) {
      throw invalidPayload("plaintext_shape");
    }

    const parsed: Record<string, string> = {};
    // Stock openNDS appends a separator after themespec before custom values.
    // Permit exactly that final separator, never empty fields in the middle.
    const fields = plaintext.endsWith(", ") ? plaintext.slice(0, -2) : plaintext;
    const pairs = fields.split(", ");
    for (const [index, pair] of pairs.entries()) {
      // openNDS 9.8 appends four NULL custom-field pointers as this exact
      // terminal fragment (http_microhttpd.c:1338-1356). It contains no fields.
      // Ignore only that confirmed suffix; all other validation stays intact.
      if (index === pairs.length - 1 && pair === "(null)(null)(null)(null)") continue;
      const separator = pair.indexOf("=");
      if (separator <= 0) throw invalidPayload("field_format", fieldFormat(pair, index === pairs.length - 1));
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!ALLOWED_FIELDS.has(name)) throw invalidPayload("unknown_field");
      if (Object.hasOwn(parsed, name)) throw invalidPayload("duplicate_field");
      if (value.length === 0 && name !== "themespec") throw invalidPayload("empty_field");
      parsed[name] = value;
    }

    if (!RETURN_HASH.test(parsed.hid ?? "")) throw invalidPayload("hid_invalid");
    if (!parsed.gatewayname || parsed.gatewayname.length > 128) throw invalidPayload("gateway_name_invalid");
    if (expectedGatewayName !== undefined && parsed.gatewayname !== expectedGatewayName) {
      throw invalidPayload("gateway_name_mismatch");
    }
    return parsed as FasFields;
  } catch (error) {
    throw error instanceof FasDiagnosticError ? error : invalidPayload("plaintext_shape");
  }
}

export function gatewayHash(gatewayName: string): Promise<string> {
  return sha256Hex(gatewayName.trim());
}

export function returnHash(hid: string, key: string): Promise<string> {
  return sha256Hex(hid.trim() + key.trim());
}

export async function buildAuthRecord(
  hid: string,
  key: string,
  registrationId: string
): Promise<string> {
  const rhid = await returnHash(hid, key);
  const opaqueId = encodeBase64(utf8Bytes(registrationId));
  return `${rhid} 480 5000 20000 0 0 ${opaqueId}`;
}

function rawUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function encodeAuthList(records: string[]): string {
  if (records.length === 0) return "*";
  return `* ${records.map(rawUrlEncode).join(" ")}`;
}

export function parseAckPayload(payloadBase64: string, maxDecodedBytes = 2_048): string[] {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64Strict(payloadBase64, maxDecodedBytes)
    );
    if (decoded === "none") return [];
    if (!/^\*(?: [a-f0-9]{64})+$/u.test(decoded)) throw new Error(INVALID_ACK);
    return [...new Set(decoded.slice(2).split(" "))];
  } catch {
    throw new Error(INVALID_ACK);
  }
}

export async function signFormState(
  fas: string,
  iv: string,
  gatewayName: string,
  expiresAt: number,
  signingKey: string
): Promise<string> {
  if (!Number.isSafeInteger(expiresAt) || signingKey.length === 0) throw new Error(INVALID_STATE);
  const state: FormState = {
    fasHash: await sha256Hex(fas),
    ivHash: await sha256Hex(iv),
    gatewayName,
    expiresAt
  };
  const payload = utf8Bytes(JSON.stringify(state));
  const signature = await hmacSha256(payload, signingKey);
  return `${encodeBase64Url(payload)}.${encodeBase64Url(signature)}`;
}

function isFormState(value: unknown): value is FormState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (
    JSON.stringify(keys) === JSON.stringify(["expiresAt", "fasHash", "gatewayName", "ivHash"]) &&
    typeof record.fasHash === "string" && RETURN_HASH.test(record.fasHash) &&
    typeof record.ivHash === "string" && RETURN_HASH.test(record.ivHash) &&
    typeof record.gatewayName === "string" && record.gatewayName.length > 0 &&
    Number.isSafeInteger(record.expiresAt)
  );
}

export async function verifyFormState(
  token: string,
  fas: string,
  iv: string,
  expectedGatewayName: string,
  nowMs: number,
  signingKey: string
): Promise<{ gatewayName: string; expiresAt: number }> {
  try {
    if (token.length > 2_048 || !Number.isSafeInteger(nowMs) || signingKey.length === 0) {
      throw new Error(INVALID_STATE);
    }
    const parts = token.split(".");
    if (parts.length !== 2) throw new Error(INVALID_STATE);
    const payload = decodeBase64UrlStrict(parts[0] ?? "", 1_024);
    const suppliedSignature = decodeBase64UrlStrict(parts[1] ?? "", 64);
    const expectedSignature = await hmacSha256(payload, signingKey);
    if (!constantTimeEqual(suppliedSignature, expectedSignature)) throw new Error(INVALID_STATE);

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    const state: unknown = JSON.parse(decoded);
    if (!isFormState(state)) throw new Error(INVALID_STATE);
    if (
      state.gatewayName !== expectedGatewayName ||
      state.expiresAt <= nowMs ||
      state.expiresAt > nowMs + 10 * 60_000 ||
      !constantTimeEqual(utf8Bytes(state.fasHash), utf8Bytes(await sha256Hex(fas))) ||
      !constantTimeEqual(utf8Bytes(state.ivHash), utf8Bytes(await sha256Hex(iv)))
    ) {
      throw new Error(INVALID_STATE);
    }
    return { gatewayName: state.gatewayName, expiresAt: state.expiresAt };
  } catch {
    throw new Error(INVALID_STATE);
  }
}
