// Helpers for scripts/seed-dev-fixtures.mjs: env loading, safety guards,
// deterministic ids, the gitignored credentials file, and Supabase clients.
// Local/test databases only.

import fs from "fs";
import crypto from "crypto";

const ROOT = new URL("../../", import.meta.url);
export const FIXTURE_DIR = new URL(".dev-fixtures/", ROOT);
const ACCOUNTS_FILE = new URL("accounts.json", FIXTURE_DIR);

export { loadEnv, adminClient, anonClient, must } from "./live.mjs";
import { confirmTestProject, projectRef } from "./live.mjs";

/** Refuses to run unless the operator typed this project's ref (and it isn't the retired one). */
export function guard(env) {
  confirmTestProject(env, "This creates fictional demo accounts and data");
  return projectRef(env.url);
}

/** Deterministic UUIDs so re-runs find (and skip) rows they already made. */
export const fixtureId = (kind, n) =>
  `00000000-0000-4000-8000-${((KINDS[kind] ?? 0) + n).toString(16).padStart(12, "0")}`;
const KINDS = { slot: 0x5100, report: 0x5300, app: 0x6000 };

/** Fixture venues outside the six curated ones get a recognisable id so a reset removes exactly them. */
export const venueFixtureId = (key) => `fixture-venue-${key}`;

export function londonDate(offsetDays) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

// ---- credentials file (gitignored, mode 600) -----------------------------
export function readAccounts() {
  try {
    return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
  } catch {
    return {};
  }
}
export function writeAccounts(accounts) {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), { mode: 0o600 });
}
export function newPassword() {
  return `Demo-${crypto.randomBytes(9).toString("base64url")}-9a`;
}
