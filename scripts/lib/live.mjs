// Shared helpers for the scripts that talk to a REAL Supabase project:
// scripts/live-journey.mjs, scripts/security-regression.mjs,
// scripts/seed-dev-fixtures.mjs and scripts/make-app-config.mjs.
//
// What they guard against:
//   * Running against the retired project (its ref is listed below) or any
//     project the operator did not explicitly name (LIVE_CONFIRM_PROJECT_REF).
//   * Sending email: accounts are created with the admin API and
//     `email_confirm: true`, which sends nothing. Nothing here calls signUp,
//     resend or password recovery, so no message is ever sent to the
//     @example.com addresses (a reserved domain with no mailboxes).
//   * Leaking the service-role key: it is read from .env.local, used only by
//     these Node scripts, and never written anywhere else.
//   * (Sign-in is password-only now; there is no second factor to go through.)

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

/** Projects that must never be used again. */
export const RETIRED_PROJECT_REFS = ["hbjwrjvdipwknaikvyev"];

const ENV_FILE = new URL("../../.env.local", import.meta.url);

export function projectRef(url) {
  return new URL(url).hostname.split(".")[0];
}

export function loadEnv({ needService = true } = {}) {
  if (!fs.existsSync(ENV_FILE)) {
    console.error("No .env.local. Copy .env.example to .env.local and fill in the NEW Supabase project's URL, anon key and service-role key.");
    process.exit(1);
  }
  const text = fs.readFileSync(ENV_FILE, "utf8");
  const get = (k) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  const env = { url: get("NEXT_PUBLIC_SUPABASE_URL"), anon: get("NEXT_PUBLIC_SUPABASE_ANON_KEY"), service: get("SUPABASE_SERVICE_ROLE_KEY") };
  if (!env.url || !env.anon || (needService && !env.service)) {
    console.error("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY" + (needService ? " and SUPABASE_SERVICE_ROLE_KEY" : "") + " must be set in .env.local.");
    process.exit(1);
  }
  const ref = projectRef(env.url);
  if (RETIRED_PROJECT_REFS.includes(ref)) {
    console.error(`.env.local points at "${ref}", the RETIRED Supabase project. Create/choose the new project and put its URL and keys in .env.local.`);
    process.exit(1);
  }
  return env;
}

/** The operator must type the project ref to say "yes, this is a test project". */
export function confirmTestProject(env, what) {
  const ref = projectRef(env.url);
  if (process.env.LIVE_CONFIRM_PROJECT_REF !== ref && process.env.SEED_CONFIRM_PROJECT_REF !== ref) {
    console.error(
      `Refusing to run.\n\n${what} in the Supabase project "${ref}". Only do that on a TEST project that you own.\n` +
        `If that is what you want, re-run with:\n\n  LIVE_CONFIRM_PROJECT_REF=${ref} node ${process.argv[1].split("/scripts/")[1] ? "scripts/" + process.argv[1].split("/scripts/")[1] : process.argv[1]}\n`
    );
    process.exit(1);
  }
  return ref;
}

const opts = { auth: { autoRefreshToken: false, persistSession: false } };
export const adminClient = (env) => createClient(env.url, env.service, opts);
export const anonClient = (env) => createClient(env.url, env.anon, opts);

export function must(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/**
 * Sign-in is password-only, so there is no second factor to complete. Kept as a
 * no-op so the scripts read the same; returns null (there is no secret).
 */
export async function reachAal2(_client, _secret) {
  return null;
}

/** Reads the `aal` claim of a supabase-js client's current access token. */
export async function aalOf(client) {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal ?? null;
}

/** A private HTTP call with a specific bearer token (to prove the REST API itself refuses, not just supabase-js). */
export async function rest(env, token, path, init = {}) {
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: env.anon, Authorization: `Bearer ${token ?? env.anon}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

export async function accessTokenOf(client) {
  return (await client.auth.getSession()).data.session?.access_token;
}

/** Representative places across the four nations (for fixtures and live checks). */
export const PLACES = {
  london: { label: "London", country: "England", region: "Greater London", lat: 51.5074, lon: -0.1278 },
  brighton: { label: "Brighton", country: "England", region: "East Sussex", lat: 50.8225, lon: -0.1372 },
  manchester: { label: "Manchester", country: "England", region: "Greater Manchester", lat: 53.4808, lon: -2.2426 },
  leeds: { label: "Leeds", country: "England", region: "West Yorkshire", lat: 53.8008, lon: -1.5491 },
  bristol: { label: "Bristol", country: "England", region: "Bristol", lat: 51.4545, lon: -2.5879 },
  edinburgh: { label: "Edinburgh, Scotland", country: "Scotland", region: "City of Edinburgh", lat: 55.9533, lon: -3.1883 },
  inverness: { label: "Inverness, Highland, Scotland", country: "Scotland", region: "Highland", lat: 57.4778, lon: -4.2247 },
  cardiff: { label: "Cardiff, Wales", country: "Wales", region: "Cardiff", lat: 51.4816, lon: -3.1791 },
  aberystwyth: { label: "Aberystwyth, Ceredigion, Wales", country: "Wales", region: "Ceredigion", lat: 52.4153, lon: -4.0829 },
  belfast: { label: "Belfast, Northern Ireland", country: "Northern Ireland", region: "Antrim", lat: 54.5973, lon: -5.9301 },
  derry: { label: "Derry, Northern Ireland", country: "Northern Ireland", region: null, lat: 54.9966, lon: -7.3086 },
  newportShropshire: { label: "Newport, Shropshire, England", country: "England", region: "Shropshire", lat: 52.7683, lon: -2.3774 },
  newportWales: { label: "Newport, Wales", country: "Wales", region: "Newport", lat: 51.5842, lon: -2.9977 },
  newportIoW: { label: "Newport, Isle of Wight, England", country: "England", region: "Isle of Wight", lat: 50.7007, lon: -1.2954 },
};
