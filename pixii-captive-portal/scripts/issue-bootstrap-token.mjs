#!/usr/bin/env node

import { createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";

const EXPECTED_PROFILE = "gl-xe3000-stock-v1";
const VALUE_FLAGS = new Set([
  "--hmac-secret-file",
  "--output-token-file",
  "--router-id",
  "--profile-id",
  "--expires-at",
  "--database"
]);

function fail(message) {
  process.stderr.write(`Token issuance failed: ${message}\n`);
  process.exitCode = 1;
}

function parseArguments(argv) {
  const values = new Map();
  let remote = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--remote") {
      if (remote) throw new Error("duplicate --remote flag");
      remote = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new Error("unsupported argument");
    if (values.has(flag) || index + 1 >= argv.length) throw new Error("invalid arguments");
    values.set(flag, argv[index + 1]);
    index += 1;
  }
  if (!remote || values.size !== VALUE_FLAGS.size) throw new Error("missing required arguments");
  return {
    secretFile: values.get("--hmac-secret-file"),
    outputFile: values.get("--output-token-file"),
    routerId: values.get("--router-id"),
    profileId: values.get("--profile-id"),
    expiresAt: values.get("--expires-at"),
    database: values.get("--database")
  };
}

function validateMetadata(options) {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(options.routerId)) throw new Error("invalid router id");
  if (options.profileId !== EXPECTED_PROFILE) throw new Error("invalid profile id");
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(options.database)) throw new Error("invalid database name");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(options.expiresAt)) {
    throw new Error("invalid expiry");
  }
  const expiry = Date.parse(options.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("expiry is not in the future");
}

function readSecret(path) {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("HMAC secret file must be a regular mode-600 file");
  }
  const secret = readFileSync(path, "utf8").trim();
  if (secret.length < 32 || /[\u0000-\u001f\u007f]/u.test(secret)) {
    throw new Error("HMAC secret is invalid");
  }
  return secret;
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createTokenFile(path, token) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${token}\n`, { encoding: "utf8" });
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function main() {
  let outputCreated = false;
  let outputFile = "";
  try {
    const options = parseArguments(process.argv.slice(2));
    outputFile = options.outputFile;
    validateMetadata(options);
    const secret = readSecret(options.secretFile);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHmac("sha256", secret).update(token).digest("hex");
    createTokenFile(outputFile, token);
    outputCreated = true;

    const command = [
      "wrangler",
      "d1",
      "execute",
      options.database,
      "--remote",
      "--command",
      `INSERT INTO bootstrap_tokens (token_hash, router_id, profile_id, expires_at, exchange_count, first_exchanged_at, last_exchanged_at) VALUES (${sqlLiteral(tokenHash)}, ${sqlLiteral(options.routerId)}, ${sqlLiteral(options.profileId)}, ${sqlLiteral(options.expiresAt)}, 0, NULL, NULL);`
    ];
    const result = spawnSync("npx", command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (result.error || result.status !== 0) throw new Error("Wrangler database insertion failed");

    process.stdout.write(`Token file: ${outputFile}\nToken hash suffix: ${tokenHash.slice(-8)}\n`);
  } catch (error) {
    if (outputCreated) {
      try {
        unlinkSync(outputFile);
      } catch {
        // The caller still receives a failure and must verify the path before retrying.
      }
    }
    fail(error instanceof Error ? error.message : "unknown error");
  }
}

main();
