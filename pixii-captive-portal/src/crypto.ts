const textEncoder = new TextEncoder();

function bytesToBinary(bytes: Uint8Array<ArrayBuffer>): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    output += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return output;
}

export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(value);
}

export function encodeBase64(bytes: Uint8Array<ArrayBuffer>): string {
  return btoa(bytesToBinary(bytes));
}

export function decodeBase64Strict(
  value: string,
  maxDecodedBytes: number
): Uint8Array<ArrayBuffer> {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error("Invalid base64.");
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Invalid base64.");
  }
  if (binary.length > maxDecodedBytes) throw new Error("Base64 value is too large.");

  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  if (encodeBase64(result) !== value) throw new Error("Invalid base64.");
  return result;
}

export function encodeBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
  return encodeBase64(bytes).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

export function decodeBase64UrlStrict(
  value: string,
  maxDecodedBytes: number
): Uint8Array<ArrayBuffer> {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("Invalid base64url.");
  }
  const remainder = value.length % 4;
  if (remainder === 1) throw new Error("Invalid base64url.");
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/") + "=".repeat((4 - remainder) % 4);
  const decoded = decodeBase64Strict(padded, maxDecodedBytes);
  if (encodeBase64Url(decoded) !== value) throw new Error("Invalid base64url.");
  return decoded;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", utf8Bytes(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256(
  value: Uint8Array<ArrayBuffer>,
  key: string
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    utf8Bytes(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, value));
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
