#!/usr/bin/env node
// Support Slot — live security regression checks (direct REST/RPC, no app).
//
// Negative tests that go straight at the Supabase API the way an attacker with
// the public anon key and a normal account would — NOT through the app — using
// real password sessions unless a check
// says otherwise. Everything created is removed in `finally`; no email is sent
// (accounts come from the admin API).
//
//   LIVE_CONFIRM_PROJECT_REF=<ref> node scripts/security-regression.mjs
//
// Requires migrations 0001–0005. Exit code 0 only if every check passed.
// STATUS: written against the new schema but NOT YET RUN (no live project yet).
// The same rules are proved against the real migrations, in-process, by
// tests/db/session-security.test.ts and friends; this script is the check that
// the deployed project behaves the same.

import {
  loadEnv, confirmTestProject, adminClient, anonClient, reachAal2, aalOf, rest, accessTokenOf, PLACES,
} from "./lib/live.mjs";

const env = loadEnv();
confirmTestProject(env, "This creates and then deletes synthetic accounts and rows");
const admin = adminClient(env);
const PASSWORD = "CorrectHorse9!Battery-Regression";
const iso = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const RUN = Math.random().toString(36).slice(2, 8);

const results = [];
const userIds = [];
const slotIds = [];
const record = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function user(role, label, { place = PLACES.london } = {}) {
  const email = `regress-${label}-${RUN}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, user_metadata: { role } });
  if (error) throw new Error(`createUser ${label}: ${error.message}`);
  const id = data.user.id;
  userIds.push(id);
  await admin.from("profiles").update({ has_onboarded: true }).eq("id", id);
  if (role === "artist") {
    await admin.from("artists").insert({ id, handle: `regress-${label}-${RUN}`, name: `Regress ${label}`, location: place.label, location_country: place.country, location_region: place.region, location_source: "search", genres: ["Indie"] });
    await admin.from("artist_locations").insert({ artist_id: id, lat: Math.round(place.lat * 100) / 100, lon: Math.round(place.lon * 100) / 100 });
  } else {
    await admin.from("promoters").insert({ id, name: `Regress ${label}`, company: `Regress Co ${label}`, location: place.label, location_country: place.country, location_region: place.region, location_source: "search" });
  }
  const client = anonClient(env);
  const si = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (si.error) throw new Error(`sign in ${label}: ${si.error.message}`);
  return { id, client, email };
}

async function main() {
  const artistA = await user("artist", "artist-a");
  const artistB = await user("artist", "artist-b", { place: PLACES.cardiff });
  const promoterA = await user("promoter", "promoter-a");
  const promoterB = await user("promoter", "promoter-b");
  const { data: venues } = await admin.from("venues").select("id").limit(1);
  const venueId = venues[0].id;
  const { data: slotA, error: slotError } = await promoterA.client.from("slots").insert({
    promoter_id: promoterA.id, venue_id: venueId, headliner: `Regress Slot ${RUN}`, date: iso(60), doors_time: "19:00", set_time: "20:00",
    performance_length_mins: 30, expected_attendance: 100, support_fee: 50, application_deadline: iso(30), genres: ["Indie"],
  }).select("id").single();
  if (slotError) throw new Error(`could not create the test listing: ${slotError.message}`);
  slotIds.push(slotA.id);
  const { data: appA } = await artistA.client.from("applications").insert({ slot_id: slotA.id, artist_id: artistA.id, message: "regress" }).select("id").single();

  // 1. Visitors
  {
    const anon = anonClient(env);
    for (const table of ["applications", "profiles", "messages", "bookings", "artist_locations", "artist_roster", "support_requests", "admin_audit_log"]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      record(`A visitor gets nothing from ${table}`, !!error || (data?.length ?? 0) === 0, error ? error.message : `${data.length} rows`);
    }
    const { error } = await anon.rpc("make_offer", { p_application_id: appA.id });
    record("A visitor cannot call make_offer", !!error, error?.message);
    const { error: e2 } = await anon.rpc("export_my_data");
    record("A visitor cannot call export_my_data", !!e2, e2?.message);
    const { error: e3 } = await anon.rpc("admin_recent_bookings", { p_limit: 5 });
    record("A visitor cannot call admin functions", !!e3, e3?.message);
  }

  // 2. A password-only session is a normal session, and only that
  {
    const solo = await user("artist", "solo");
    const t = await accessTokenOf(solo.client);
    const own = await rest(env, t, `profiles?id=eq.${solo.id}&select=id`);
    record("A password-only session reads its own profile", own.status === 200 && own.body.length === 1, `${own.status}`);
    const notes = await rest(env, t, "notifications?select=id");
    record("…and sees only its own notifications (none yet)", notes.status === 200 && notes.body.length === 0, `${notes.status}`);
    const spoof = await rest(env, t, "applications", { method: "POST", body: JSON.stringify({ slot_id: slotA.id, artist_id: artistB.id }) });
    record("…but cannot apply as another artist", spoof.status >= 400, `${spoof.status}`);
    const staff = await solo.client.rpc("staff_audit_log", { p_limit: 5 });
    record("…and has no staff powers", !!staff.error, staff.error?.message);
  }

  // 3. Cross-account access and ownership spoofing
  {
    await artistA.client.from("artists").update({ bio: "hijacked" }).eq("id", artistB.id);
    const { data } = await admin.from("artists").select("bio").eq("id", artistB.id).single();
    record("Artist A cannot overwrite artist B's profile", data?.bio !== "hijacked");
    const { data: seen } = await promoterB.client.from("applications").select("id").eq("id", appA.id);
    record("Promoter B cannot see an application on promoter A's listing", (seen?.length ?? 0) === 0);
    const { error: spoof } = await artistB.client.from("applications").insert({ slot_id: slotA.id, artist_id: artistA.id });
    record("An artist cannot apply as someone else", !!spoof, spoof?.message);
    const { error: asPromoter } = await artistA.client.from("slots").insert({ promoter_id: artistA.id, venue_id: venueId, headliner: "x", date: iso(30), doors_time: "19:00", set_time: "20:00", performance_length_mins: 30, expected_attendance: 10, support_fee: 1, application_deadline: iso(20), genres: ["Indie"] });
    record("An artist cannot create a listing", !!asPromoter, asPromoter?.message);
    const { data: coords } = await artistB.client.from("artist_locations").select("*").eq("artist_id", artistA.id);
    record("Artist B cannot read artist A's private coordinates", (coords?.length ?? 0) === 0);
    const { data: mine } = await artistA.client.from("artist_locations").select("lat, lon");
    record("Artist A can read their own (rounded) coordinates", mine?.length === 1);
    const { error: plant } = await artistA.client.from("artist_locations").insert({ artist_id: artistB.id, lat: 51, lon: -1 });
    record("Nobody can write artist_locations directly", !!plant, plant?.message);
    const { error: relabel } = await artistA.client.from("artists").update({ location: "Somewhere Else" }).eq("id", artistA.id);
    record("An artist can't change the public location label without the picker function", !!relabel, relabel?.message);
    const { error: viaFn } = await artistA.client.rpc("set_my_location", { p_label: "Leeds", p_country: "England", p_region: "West Yorkshire", p_lat: 53.801234, p_lon: -1.549123, p_source: "search" });
    const { data: rounded } = await artistA.client.from("artist_locations").select("lat, lon").single();
    record("set_my_location works and stores ~1 km-rounded coordinates", !viaFn && rounded?.lat === 53.8 && rounded?.lon === -1.55, `${viaFn?.message ?? ""} ${JSON.stringify(rounded)}`);
    const { error: nz } = await artistA.client.rpc("set_my_location", { p_label: "Paris", p_country: "England", p_region: null, p_lat: 48.85, p_lon: 2.35, p_source: "search" });
    record("A place outside the UK is refused", !!nz, nz?.message);
  }

  // 4. Mass assignment / escalation
  {
    await promoterA.client.from("profiles").update({ role: "artist" }).eq("id", promoterA.id);
    const { data: r } = await admin.from("profiles").select("role").eq("id", promoterA.id).single();
    record("profiles.role cannot be changed", r?.role === "promoter");
    for (const patch of [{ admin_role: "admin" }, { suspended_at: null }, { email: "x@example.com" }]) {
      await artistA.client.from("profiles").update(patch).eq("id", artistA.id);
    }
    const { data: p } = await admin.from("profiles").select("admin_role, email").eq("id", artistA.id).single();
    record("A user cannot grant themselves staff or change their stored email", p?.admin_role === null && p?.email === `regress-artist-a-${RUN}@example.com`);
    await artistA.client.from("artists").update({ verification: "verified" }).eq("id", artistA.id);
    const { data: v } = await admin.from("artists").select("verification").eq("id", artistA.id).single();
    record("An artist cannot self-verify", v?.verification === "unverified");
    await promoterA.client.from("promoters").update({ shows_posted: 9999 }).eq("id", promoterA.id);
    const { data: sp } = await admin.from("promoters").select("shows_posted").eq("id", promoterA.id).single();
    record("A promoter cannot inflate shows_posted", sp?.shows_posted !== 9999);
    for (const forged of ["shortlisted", "offered", "confirmed", "cancelled"]) {
      await artistA.client.from("applications").update({ status: forged }).eq("id", appA.id);
    }
    const { data: a } = await admin.from("applications").select("status").eq("id", appA.id).single();
    record("An artist cannot set their own application status", a?.status === "submitted" || a?.status === "viewed", a?.status);
    const { error: bk } = await promoterA.client.from("bookings").insert({ slot_id: slotA.id, artist_id: artistA.id, promoter_id: promoterA.id, status: "confirmed" });
    record("A client cannot insert a booking directly", !!bk, bk?.message);
    const { error: notif } = await admin.rpc("notify", { p_profile_id: artistA.id, p_type: "system", p_text: "Original", p_href: "/applications" }); // service role only
    await artistA.client.from("notifications").update({ text: "Rewritten" }).eq("profile_id", artistA.id);
    const { data: n } = await admin.from("notifications").select("text").eq("profile_id", artistA.id).eq("text", "Rewritten");
    record("A user cannot rewrite their own notification text", !notif && (n?.length ?? 0) === 0, notif?.message);
    const { error: internal } = await artistA.client.rpc("notify", { p_profile_id: artistB.id, p_type: "system", p_text: "forged", p_href: null });
    record("Internal functions are not callable by clients (notify)", !!internal, internal?.message);
    const { error: rl } = await artistA.client.rpc("rate_limit_hit", { p_key: "x", p_limit: 1, p_window_seconds: 60 });
    record("The rate limiter is not callable by clients", !!rl, rl?.message);
  }

  // 5. Staff boundaries
  {
    const { error } = await artistA.client.rpc("admin_suspend_user", { p_profile_id: artistB.id, p_reason: "regression test" });
    record("A normal user cannot call staff actions", !!error, error?.message);
    const { data } = await artistA.client.rpc("staff_find_users", { p_q: "", p_limit: 5 });
    record("A normal user cannot read the staff user directory", !data || data.length === 0);
    const mod = await user("promoter", "mod");
    await admin.from("profiles").update({ admin_role: "moderator" }).eq("id", mod.id);
    const { error: noAdmin } = await mod.client.rpc("admin_recent_bookings", { p_limit: 5 });
    record("A moderator cannot read the admin-only bookings list", !!noAdmin, noAdmin?.message);
    const { error: noVerify } = await mod.client.rpc("admin_set_verification", { p_profile_id: artistA.id, p_verified: true });
    record("A moderator cannot verify users", !!noVerify, noVerify?.message);
    const { error: audit } = await mod.client.from("admin_audit_log").insert({ actor_role: "admin", action: "forged", target_type: "x" });
    record("Staff cannot write the audit log directly", !!audit, audit?.message);
    const before = (await admin.from("admin_audit_log").select("id", { count: "exact", head: true })).count;
    await mod.client.rpc("admin_suspend_user", { p_profile_id: artistB.id, p_reason: "no" }); // reason too short: must fail and leave no audit row
    const after = (await admin.from("admin_audit_log").select("id", { count: "exact", head: true })).count;
    record("A failed staff action leaves no audit row", before === after, `${before} → ${after}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  for (const f of failed) console.log(`  FAILED: ${f.name}`);
  return failed.length === 0;
}

async function cleanup() {
  try {
    if (slotIds.length) await admin.from("bookings").delete().in("slot_id", slotIds);
    await admin.from("slots").delete().in("id", slotIds);
    await admin.from("admin_audit_log").delete().in("target_id", userIds);
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  } catch (e) {
    console.error("cleanup problem (synthetic rows may remain):", e?.message ?? e);
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
