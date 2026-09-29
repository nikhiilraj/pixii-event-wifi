import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode
} from "libphonenumber-js/min";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> };

export interface Signup {
  fullName: string;
  email: string;
  emailNormalized: string;
  phoneCountry: CountryCode;
  phoneE164: string;
  consentEmailMarketing: true;
}

export interface BootstrapRequest {
  bootstrapToken: string;
  installerVersion: string;
  profileId: "gl-xe3000-stock-v1";
}

export class RequestParseError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    readonly code: "body_too_large" | "invalid_body" | "unsupported_content_type",
    message: string
  ) {
    super(message);
    this.name = "RequestParseError";
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u;

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function stringValue(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

function validateName(value: string): string | null {
  const length = Array.from(value).length;
  if (length < 2 || length > 100 || CONTROL_CHARACTERS.test(value)) {
    return "Enter your full name.";
  }
  return null;
}

function validateEmail(value: string): string | null {
  if (
    value.length === 0 ||
    value.length > 254 ||
    CONTROL_CHARACTERS.test(value) ||
    !EMAIL_PATTERN.test(value)
  ) {
    return "Enter a valid work email.";
  }

  const [local, domain] = value.split("@");
  if (
    !local ||
    local.length > 64 ||
    !domain ||
    domain.length > 253 ||
    domain.split(".").some((label) => label.length === 0 || label.length > 63)
  ) {
    return "Enter a valid work email.";
  }
  return null;
}

function normalizePhone(value: string, country: CountryCode): string | null {
  if (
    value.length === 0 ||
    value.length > 32 ||
    CONTROL_CHARACTERS.test(value) ||
    !/^\+?[0-9\s()./-]+$/u.test(value) ||
    (value.includes("+") && !value.startsWith("+"))
  ) {
    return null;
  }

  try {
    const phone = parsePhoneNumberFromString(value, { defaultCountry: country, extract: false });
    if (!phone || phone.country !== country || !phone.isValid()) return null;
    return phone.number;
  } catch {
    return null;
  }
}

export function validateSignup(input: unknown): ValidationResult<Signup> {
  if (!isRecord(input)) {
    return { ok: false, errors: { form: "Check the form and try again." } };
  }

  const fullName = stringValue(input, "fullName").trim();
  const email = stringValue(input, "email").trim();
  const requestedCountry = stringValue(input, "phoneCountry").trim().toUpperCase();
  const phone = stringValue(input, "phone").trim();
  const phoneCountry = isSupportedCountry(requestedCountry) ? requestedCountry : null;
  const phoneE164 = phoneCountry ? normalizePhone(phone, phoneCountry) : null;
  const errors: Record<string, string> = {};

  const nameError = validateName(fullName);
  if (nameError) errors.fullName = nameError;
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  if (!phoneCountry) errors.phoneCountry = "Choose a valid calling code.";
  if (!phoneE164) errors.phone = "Enter a valid phone number.";
  if (input.consent !== "accepted") {
    errors.consent = "Please check the box to connect to Wi-Fi.";
  }

  if (Object.keys(errors).length > 0 || !phoneCountry || !phoneE164) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      emailNormalized: email.toLowerCase(),
      phoneCountry,
      phoneE164,
      consentEmailMarketing: true
    }
  };
}

export async function parseBody(
  request: Request,
  maxBytes: number
): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      if (request.body && !request.body.locked) {
        try {
          await request.body.cancel();
        } catch {
          // The size rejection still takes precedence if the producer cannot be cancelled.
        }
      }
      throw new RequestParseError(413, "body_too_large", "The request body is too large.");
    }
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  if (request.body) {
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new RequestParseError(413, "body_too_large", "The request body is too large.");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RequestParseError(400, "invalid_body", "The request body is invalid.");
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  try {
    if (contentType === "application/json") {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) throw new Error("not an object");
      return parsed;
    }
    if (contentType === "application/x-www-form-urlencoded") {
      const params = new URLSearchParams(text);
      const result: Record<string, string> = {};
      for (const [key, value] of params) {
        if (Object.hasOwn(result, key)) throw new Error("duplicate field");
        result[key] = value;
      }
      return result;
    }
  } catch {
    throw new RequestParseError(400, "invalid_body", "The request body is invalid.");
  }

  throw new RequestParseError(
    415,
    "unsupported_content_type",
    "The request content type is not supported."
  );
}

export function validateBootstrapRequest(input: unknown): ValidationResult<BootstrapRequest> {
  if (!isRecord(input)) {
    return { ok: false, errors: { request: "The setup request is invalid." } };
  }

  const expectedKeys = ["bootstrap_token", "installer_version", "profile_id"];
  const actualKeys = Object.keys(input).sort();
  const errors: Record<string, string> = {};
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    errors.request = "The setup request fields are invalid.";
  }

  const bootstrapToken = stringValue(input, "bootstrap_token");
  const installerVersion = stringValue(input, "installer_version");
  const profileId = stringValue(input, "profile_id");
  if (!/^[A-Za-z0-9._~-]{24,256}$/u.test(bootstrapToken)) {
    errors.bootstrapToken = "The setup code is invalid.";
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(installerVersion)) {
    errors.installerVersion = "The installer version is invalid.";
  }
  if (profileId !== "gl-xe3000-stock-v1") {
    errors.profileId = "The router profile is invalid.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      bootstrapToken,
      installerVersion,
      profileId: "gl-xe3000-stock-v1"
    }
  };
}
