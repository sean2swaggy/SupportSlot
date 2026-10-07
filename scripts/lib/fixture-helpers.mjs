// Helpers for scripts/seed-dev-fixtures.mjs: env loading, safety guards,
// deterministic ids, the gitignored credentials file, and Supabase clients.
// Local/test databases only.

import fs from "fs";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const ROOT = new URL("../../", import.meta.url);
export const FIXTURE_DIR = new URL(".dev-fixtures/", ROOT);
const ACCOUNTS_FILE = new URL("accounts.json", FIXTURE_DIR);

export function loadEnv() {
  const text = fs.readFileSync(new URL(".env.local", ROOT), "utf8");
  const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  return {
    url: get("NEXT_PUBLIC_SUPABASE_URL"),
    anon: get("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    service: get("SUPABASE_SERVICE_ROLE_KEY"),
    stripe: get("STRIPE_SECRET_KEY"),
  };
}

/** Refuses to run unless the operator typed this project's ref and Stripe is in test mode. */
export function guard(env) {
  const ref = new URL(env.url).hostname.split(".")[0];
  if (process.env.SEED_CONFIRM_PROJECT_REF !== ref) {
    console.error(
      `Refusing to run.\n\nThis would create fictional demo accounts and data in the Supabase project "${ref}".\n` +
        `Only do that on a TEST project. If that is what you want, re-run with:\n\n` +
        `  SEED_CONFIRM_PROJECT_REF=${ref} node scripts/seed-dev-fixtures.mjs\n`
    );
    process.exit(1);
  }
  if (env.stripe && !env.stripe.startsWith("sk_test_")) {
    console.error("Refusing to run: STRIPE_SECRET_KEY is not a test-mode key.");
    process.exit(1);
  }
  return ref;
}

/** Deterministic UUIDs so re-runs find (and skip) rows they already made. */
export const fixtureId = (kind, n) =>
  `00000000-0000-4000-8000-${((KINDS[kind] ?? 0) + n).toString(16).padStart(12, "0")}`;
const KINDS = { slot: 0x5100, report: 0x5300, app: 0x6000 };

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

// ---- clients ---------------------------------------------------------------
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const adminClient = (env) => createClient(env.url, env.service, opts);
export const anonClient = (env) => createClient(env.url, env.anon, opts);

/** Throws a readable error when a Supabase call failed. */
export function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
