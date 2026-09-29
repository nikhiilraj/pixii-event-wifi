#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function run(args) {
  const result = spawnSync("npx", ["wrangler", ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Browser database setup failed.\n");
    process.exit(result.status ?? 1);
  }
}

const browserState = ".wrangler/flyby-browser-state";
run(["d1", "migrations", "apply", "pixii-event-wifi-production", "--local", "--persist-to", browserState]);

const now = "2026-09-23T16:00:00Z";
const sql = `
DELETE FROM auth_queue;
DELETE FROM registrations;
DELETE FROM bootstrap_tokens;
DELETE FROM routers;
DELETE FROM events;
INSERT INTO events (id, slug, display_name, timezone, starts_at, ends_at, retention_days, created_at)
VALUES ('evt_browser', 'amazon-unboxed-sf-2026', 'Amazon Unboxed SF', 'America/Los_Angeles', '${now}', '2030-01-01T00:00:00Z', 365, '${now}');
INSERT INTO routers (id, event_id, profile_id, gateway_name, gateway_hash, enabled, created_at, updated_at)
VALUES ('rtr_puli', 'evt_browser', 'gl-xe3000-stock-v1', 'pixii-unboxed-sf-puli-01', 'b1f5a813821f8a6a168025e7010fdfac38484bf541da99dfcb4c074ea1a6b7f7', 1, '${now}', '${now}');
`;
run(["d1", "execute", "pixii-event-wifi-production", "--local", "--persist-to", browserState, "--command", sql]);
