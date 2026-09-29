// Deliberately finite, value-free diagnostics: never pass a Request, payload,
// submitted fields, or an exception message/stack to the logger.
export type FasFailureReason =
  | "payload_length" | "key_missing" | "iv_length"
  | "outer_base64" | "inner_utf8" | "inner_base64" | "ciphertext_length"
  | "key_import" | "decrypt_failed" | "plaintext_utf8"
  | "plaintext_shape" | "field_format" | "unknown_field" | "duplicate_field"
  | "empty_field" | "hid_invalid" | "gateway_name_invalid" | "gateway_name_mismatch"
  | "router_unknown" | "router_disabled" | "router_identity_mismatch";

export type FasFieldFormat =
  | "null_suffix_1" | "null_suffix_2" | "null_suffix_3" | "null_suffix_4"
  | "null_fragment_elsewhere" | "empty_fragment" | "missing_field_name" | "missing_equals";

export class FasDiagnosticError extends Error {
  constructor(readonly reason: FasFailureReason, readonly format?: FasFieldFormat) {
    // Preserve the original generic error; details are private log metadata only.
    super("Invalid captive portal payload.");
  }
}

export interface FasDiagnosticContext {
  stage: "query_fas" | "query_iv" | "submit_fields" | "decrypt" | "fields"
    | "router_lookup" | "router_identity" | "form_signing" | "form_state" | "render";
}

export function logFasRejection(
  route: "/router/fas" | "/router/fas/submit",
  context: FasDiagnosticContext,
  error: unknown
): string {
  const reference = crypto.randomUUID();
  const reason = error instanceof FasDiagnosticError ? error.reason
    : ["query_fas", "query_iv", "submit_fields", "form_state"].includes(context.stage)
      ? "invalid_input" : "unexpected";
  const format = error instanceof FasDiagnosticError && error.reason === "field_format"
    ? error.format : undefined;
  try {
    console.warn(JSON.stringify({
      event: "pixii_fas_rejected", reference, route, stage: context.stage, reason,
      ...(format === undefined ? {} : { format })
    }));
  } catch {
    // A broken log sink must never change whether the request is rejected.
  }
  return reference;
}
