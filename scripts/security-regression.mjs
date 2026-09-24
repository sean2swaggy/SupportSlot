#!/usr/bin/env node
// Support Slot — security regression checks.
//
// Runs real negative-test scenarios against the LIVE Supabase project
// configured in .env.local (Stripe stays in test mode throughout — nothing
// here charges a real card). Every account/row this script creates is
// deleted again at the end, in a `finally` block, even on failure.
//
// Usage:
//   node scripts/security-regression.mjs
//
// This is deliberately NOT part of `npm test` — it needs real network
// access to the configured Supabase project and takes a few seconds, which
// doesn't belong in the fast unit-test loop `npm test` is for.
//
// Exit code is 0 only if every check passed.

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => {
  const m = env.match(new RegExp(`^${k}=(.*)$`, "m"));
  if (!m) throw new Error(`${k} not set in .env.local`);
  return m[1].trim();
};

const SUPABASE_URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const PASSWORD = "CorrectHorse9!Battery-Regression";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const results = [];
const cleanupUserIds = [];
const cleanupRows = []; // [{ table, id }]

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function newUser(role, emailPrefix) {
  const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const client = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await client.auth.signUp({
    email,
    password: PASSWORD,
    options: { data: { role } },
  });
  if (error || !data.user) throw new Error(`signUp failed for ${email}: ${error?.message}`);
  cleanupUserIds.push(data.user.id);
  return { client, id: data.user.id, email };
}

async function main() {
  // ---------------------------------------------------------------------
  // Setup: two artists, two promoters, a venue, a slot, an application.
  // ---------------------------------------------------------------------
  const artistA = await newUser("artist", "regress-artist-a");
  const artistB = await newUser("artist", "regress-artist-b");
  const promoterA = await newUser("promoter", "regress-promoter-a");
  const promoterB = await newUser("promoter", "regress-promoter-b");

  await artistA.client.from("artists").insert({
    id: artistA.id, handle: `regress-a-${artistA.id.slice(0, 8)}`, name: "Regress Artist A", location: "London",
  });
  await artistB.client.from("artists").insert({
    id: artistB.id, handle: `regress-b-${artistB.id.slice(0, 8)}`, name: "Regress Artist B", location: "London",
  });
  await promoterA.client.from("promoters").insert({
    id: promoterA.id, name: "Regress Promoter A", company: "Regress Co A", location: "London",
  });
  await promoterB.client.from("promoters").insert({
    id: promoterB.id, name: "Regress Promoter B", company: "Regress Co B", location: "London",
  });

  const { data: venues } = await admin.from("venues").select("id").limit(1);
  const venueId = venues[0].id;

  const { data: slotA } = await promoterA.client
    .from("slots")
    .insert({
      promoter_id: promoterA.id, venue_id: venueId, headliner: "Regress Slot A", city: "London",
      date: "2026-12-01", doors_time: "19:00", set_time: "20:00", performance_length_mins: 30,
      expected_attendance: 100, support_fee: 5000, application_deadline: "2026-11-01",
    })
    .select("id")
    .single();
  cleanupRows.push({ table: "slots", id: slotA.id });

  const { data: applicationA } = await artistA.client
    .from("applications")
    .insert({ slot_id: slotA.id, artist_id: artistA.id, match_percent: 80, message: "regress" })
    .select("id")
    .single();
  cleanupRows.push({ table: "applications", id: applicationA.id });

  // ---------------------------------------------------------------------
  // 1. Unauthenticated access to a protected operation.
  // ---------------------------------------------------------------------
  {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data, error } = await anon.from("applications").select("id").limit(1);
    // applications has no public-select policy — an anonymous client must
    // get zero rows back (RLS silently filters, it doesn't error).
    record(
      "Unauthenticated client cannot read applications",
      !error && (data?.length ?? 0) === 0,
      error ? error.message : `${data?.length ?? 0} rows returned`
    );
  }
  {
    const res = await fetch(`${APP_URL}/dashboard/artist`, { redirect: "manual" });
    record(
      "Unauthenticated request to a protected page is redirected, not served",
      res.status >= 300 && res.status < 400,
      `status ${res.status}`
    );
  }

  // ---------------------------------------------------------------------
  // 2. One artist reading/writing another artist's private data.
  // ---------------------------------------------------------------------
  {
    const { error } = await artistA.client
      .from("artists")
      .update({ bio: "hijacked by artist A" })
      .eq("id", artistB.id);
    const { data: check } = await admin.from("artists").select("bio").eq("id", artistB.id).single();
    record(
      "Artist A cannot overwrite artist B's profile row",
      check?.bio !== "hijacked by artist A",
      error ? error.message : "no error returned, but row unaffected (RLS filtered the WHERE)"
    );
  }

  // ---------------------------------------------------------------------
  // 3. One promoter reading another promoter's private applications.
  // ---------------------------------------------------------------------
  {
    const { data, error } = await promoterB.client
      .from("applications")
      .select("id")
      .eq("id", applicationA.id);
    record(
      "Promoter B cannot see an application on promoter A's slot",
      !error && (data?.length ?? 0) === 0,
      error ? error.message : `${data?.length ?? 0} rows returned`
    );
  }

  // ---------------------------------------------------------------------
  // 4. Role escalation / ownership-field tampering.
  // ---------------------------------------------------------------------
  {
    const { error } = await promoterA.client.from("profiles").update({ role: "artist" }).eq("id", promoterA.id);
    const { data: check } = await admin.from("profiles").select("role").eq("id", promoterA.id).single();
    record(
      "profiles.role cannot be changed after signup (prevent_role_change trigger)",
      check?.role === "promoter",
      error ? error.message : "no error returned, but role unchanged"
    );
  }
  {
    const { error } = await promoterA.client
      .from("profiles")
      .update({ is_support_plus: true })
      .eq("id", promoterA.id);
    const { data: check } = await admin.from("profiles").select("is_support_plus").eq("id", promoterA.id).single();
    record(
      "A client cannot self-grant Support+ (profiles.is_support_plus is service-role only)",
      check?.is_support_plus === false,
      error ? error.message : "no error returned, but flag unchanged"
    );
  }
  {
    // This is the mass-assignment gap fixed by
    // 0018_lock_down_trust_and_payment_fields.sql — FAILS until that
    // migration has been applied to this project (see the launch-risk
    // report for why it can't be applied by this script).
    const { error } = await artistA.client
      .from("artists")
      .update({ verification: "verified", stripe_account_id: "acct_fake", stripe_transfers_active: true })
      .eq("id", artistA.id);
    const { data: check } = await admin
      .from("artists")
      .select("verification, stripe_account_id, stripe_transfers_active")
      .eq("id", artistA.id)
      .single();
    record(
      "Artist cannot self-set verification / Stripe payout fields (needs migration 0018)",
      check?.verification === "unverified" && !check?.stripe_transfers_active,
      error ? error.message : "no error returned — fields were written by the client"
    );
  }
  {
    // Same migration — an artist should only ever be able to move their OWN
    // application to 'cancelled', never self-shortlist.
    const { error } = await artistA.client
      .from("applications")
      .update({ status: "shortlisted" })
      .eq("id", applicationA.id);
    const { data: check } = await admin.from("applications").select("status").eq("id", applicationA.id).single();
    record(
      "Artist cannot self-shortlist their own application (needs migration 0018)",
      check?.status !== "shortlisted",
      error ? error.message : "no error returned — status was written by the client"
    );
  }
  {
    const { error } = await artistA.client
      .from("applications")
      .update({ status: "booked" })
      .eq("id", applicationA.id);
    const { data: check } = await admin.from("applications").select("status").eq("id", applicationA.id).single();
    record(
      "Artist cannot self-book their own application (status='booked' stays service-role only)",
      check?.status !== "booked",
      error ? error.message : "no error returned — status was written by the client"
    );
  }

  // ---------------------------------------------------------------------
  // 5. Manipulated payment amount / recipient / booking id.
  // ---------------------------------------------------------------------
  {
    const res = await fetch(`${APP_URL}/api/stripe/payments/create-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: applicationA.id }),
    });
    record(
      "create-intent rejects a request with no session, regardless of applicationId supplied",
      res.status === 401,
      `status ${res.status}`
    );
  }

  // ---------------------------------------------------------------------
  // 6. Invalid / replayed webhook signatures.
  // ---------------------------------------------------------------------
  {
    const res = await fetch(`${APP_URL}/api/stripe/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=invalid" },
      body: JSON.stringify({ type: "payment_intent.succeeded", data: { object: {} } }),
    });
    record(
      "Webhook with an invalid signature is rejected, not processed",
      res.status === 400,
      `status ${res.status}`
    );
  }
  {
    const res = await fetch(`${APP_URL}/api/stripe/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    record(
      "Webhook endpoint is actually reachable (not redirected to /login by middleware)",
      res.status === 400 && !res.redirected,
      `status ${res.status}, redirected=${res.redirected}`
    );
  }

  // ---------------------------------------------------------------------
  // 7. Malicious profile content (javascript: URL in a platform link).
  // Covered by src/lib/artist-links.test.ts (`npm test`) instead of here —
  // isSafeExternalUrl is a plain TS function with no live dependency, and
  // this script's plain-Node runtime has no TS loader to import it with.
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.log("\nFailed:");
    for (const f of failed) console.log(`  - ${f.name}`);
  }
  return failed.length === 0;
}

async function cleanup() {
  for (const { table, id } of cleanupRows.reverse()) {
    await admin.from(table).delete().eq("id", id);
  }
  for (const id of cleanupUserIds) {
    await admin.auth.admin.deleteUser(id);
  }
}

let ok = false;
try {
  ok = await main();
} catch (err) {
  console.error("Regression script crashed:", err);
} finally {
  await cleanup();
}
process.exit(ok ? 0 : 1);
